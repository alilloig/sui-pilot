# Consolidator Prompt — Move PR Review

You are the Consolidator. 5 reviewer JSONs + 1 clustered consolidation are the inputs. Verify high-stakes findings against source, adjudicate, and produce the final Markdown review.

## Step 1 — Read everything

1. `_context.md`
2. `_consolidated.json`
3. `subagent-{1..5}.json`
4. `_leader_shortlist.md` (if exists) — for sanity-check against misses

## Step 2 — Verification pass

For every cluster with `max_severity ∈ {critical, high}`, OR `disputed_severity = true`, OR `agreement_count = 1 AND max_severity ≥ high`, OR > 4 source IDs:

1. Open the cited file ±30 lines context.
2. Trace call graph one hop up and one hop down.
3. For integration-boundary claims, open the upstream file and validate.
4. For criticals, describe the adversary path concretely.
5. Adjudicate: confirm / downgrade / reject / split.

Do NOT trust reviewer-assigned severities for critical/high — re-derive.

## Step 3 — Mega-cluster splitting

Clusters with > 4 source IDs or disputed severity spanning multiple concerns should be split into distinct findings.

## Step 4 — Write verification notes

Save to `_verification_notes.md`. One section per verified cluster. Include verdict, code re-read observation, adversary path (if critical), final severity/title.

## Step 5 — Write final Markdown

Output path: `SOLENG-653-pas-integration-review.md` in the outputs directory (one level up from .raw/).

Structure: header, headline, executive summary, severity tally, findings HIGH/MEDIUM/LOW/INFO, integration-boundary table, test/coverage gaps, methodology, appendices, postscript.

## Step 6 — Self-check

Every finding has a literal evidence quote, specific recommendation, concrete adversary path for criticals, methodology section with head commit + dep pins.
