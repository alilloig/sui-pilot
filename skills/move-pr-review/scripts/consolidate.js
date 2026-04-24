#!/usr/bin/env node
// Cluster reviewer findings by (file, line-range overlap, category)
// with title-similarity tie-breaker. Emits _consolidated.json.
//
// Usage: node consolidate.js <raw-dir>
//   <raw-dir> defaults to "reviews/.raw"
//
// Reads:  <raw-dir>/subagent-{1..10}.json (and optionally subagent-0.json for leader backfill)
// Writes: <raw-dir>/_consolidated.json
//
// Each cluster has:
//   cluster_id, title, file, line_ranges, agreement_count, reviewers,
//   max_severity, min_severity, disputed_severity, categories,
//   recommendations, descriptions, impacts, evidence (longest),
//   confidence_spread, source_ids

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.resolve(process.argv[2] || 'reviews/.raw');
const OUT = path.join(RAW_DIR, '_consolidated.json');
const REVIEWERS = parseInt(process.env.REVIEWERS || '10', 10);

function loadAll() {
  const all = [];
  for (let n = 0; n <= REVIEWERS; n++) {
    const p = path.join(RAW_DIR, `subagent-${n}.json`);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') continue;
      console.error(`SKIP: ${p} read error: ${e.message}`); continue;
    }
    let arr;
    try { arr = JSON.parse(raw); }
    catch (e) { console.error(`SKIP: ${p} not valid JSON: ${e.message}`); continue; }
    if (!Array.isArray(arr)) { console.error(`SKIP: ${p} is not an array`); continue; }
    for (const f of arr) {
      f.reviewer = n;
      all.push(f);
    }
  }
  return all;
}

function parseRange(s) {
  s = String(s || '').trim();
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(x => parseInt(x.trim(), 10));
    return [isNaN(a) ? 0 : a, isNaN(b) ? a : b];
  }
  const n = parseInt(s, 10);
  return [isNaN(n) ? 0 : n, isNaN(n) ? 0 : n];
}

function overlap(a, b, slack = 6) {
  const [a0, a1] = a;
  const [b0, b1] = b;
  return Math.max(a0, b0) - slack <= Math.min(a1, b1) + slack;
}

const STOP = new Set([
  'the','and','for','with','from','that','this','over','when','into','not','missing','check',
  'pas','move','has','use','its','can','are','should','must','does','will','would','have'
]);
function tokenize(s) {
  return new Set(
    String(s || '').toLowerCase()
      .replace(/[^a-z0-9_ ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t))
  );
}
function titleSimilarity(a, b) {
  const A = tokenize(a), B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

function main() {
  const all = loadAll();
  if (all.length === 0) {
    console.error('No findings loaded — exiting.');
    process.exit(1);
  }

  const byFile = {};
  for (const f of all) {
    const k = f.file || '<unknown>';
    if (!byFile[k]) byFile[k] = [];
    byFile[k].push(f);
  }

  const clusters = [];
  for (const findings of Object.values(byFile)) {
    const assigned = new Array(findings.length).fill(false);
    for (let i = 0; i < findings.length; i++) {
      if (assigned[i]) continue;
      const cluster = [findings[i]];
      assigned[i] = true;
      const base = findings[i];
      const baseRange = parseRange(base.line_range);
      for (let j = i + 1; j < findings.length; j++) {
        if (assigned[j]) continue;
        const cand = findings[j];
        const candRange = parseRange(cand.line_range);
        const rangeOverlap = overlap(baseRange, candRange, 6);
        const titleSim = titleSimilarity(base.title, cand.title);
        const sameCat = base.category === cand.category;
        if ((rangeOverlap && (sameCat || titleSim >= 0.4)) || titleSim >= 0.6) {
          cluster.push(cand);
          assigned[j] = true;
        }
      }
      clusters.push(cluster);
    }
  }

  const SEV_ORDER = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const consolidated = clusters.map((c, idx) => {
    const reviewers = [...new Set(c.map(f => f.reviewer))].sort();
    const severities = c.map(f => f.severity);
    const maxSev = severities.reduce((a, b) => SEV_ORDER[a] > SEV_ORDER[b] ? a : b, 'info');
    const minSev = severities.reduce((a, b) => SEV_ORDER[a] < SEV_ORDER[b] ? a : b, 'critical');
    const disputed = maxSev !== minSev && SEV_ORDER[maxSev] - SEV_ORDER[minSev] >= 2;
    const categories = [...new Set(c.map(f => f.category))];
    const longestEvidence = c.map(f => f.evidence || '').sort((a, b) => b.length - a.length)[0];
    const bestTitle = [...c].sort((a, b) => (b.title || '').length - (a.title || '').length)[0].title;
    return {
      cluster_id: `C${String(idx + 1).padStart(3, '0')}`,
      title: bestTitle,
      file: c[0].file,
      line_ranges: [...new Set(c.map(f => f.line_range))],
      agreement_count: reviewers.length,
      reviewers,
      max_severity: maxSev,
      min_severity: minSev,
      disputed_severity: disputed,
      categories,
      recommendations: [...new Set(c.map(f => (f.recommendation || '').trim()))],
      descriptions: [...new Set(c.map(f => (f.description || '').trim()))],
      impacts: [...new Set(c.map(f => (f.impact || '').trim()))],
      evidence: longestEvidence,
      confidence_spread: [...new Set(c.map(f => f.confidence))],
      source_ids: c.map(f => f.id),
    };
  });

  consolidated.sort((a, b) => {
    const d = SEV_ORDER[b.max_severity] - SEV_ORDER[a.max_severity];
    if (d !== 0) return d;
    return b.agreement_count - a.agreement_count;
  });

  fs.writeFileSync(OUT, JSON.stringify(consolidated, null, 2));

  console.log(`Raw findings: ${all.length}`);
  console.log(`Clusters: ${consolidated.length}`);
  console.log('');
  console.log('Clusters by max_severity:');
  const bySev = {};
  for (const c of consolidated) bySev[c.max_severity] = (bySev[c.max_severity] || 0) + 1;
  for (const s of ['critical','high','medium','low','info']) {
    if (bySev[s]) console.log(`  ${s}: ${bySev[s]}`);
  }
  console.log('');
  console.log('Clusters by agreement (unique reviewers):');
  const byAgree = {};
  for (const c of consolidated) byAgree[c.agreement_count] = (byAgree[c.agreement_count] || 0) + 1;
  for (const k of Object.keys(byAgree).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  ${k}/${REVIEWERS} reviewers: ${byAgree[k]}`);
  }
  console.log('');
  console.log(`Output: ${OUT}`);
}

main();
