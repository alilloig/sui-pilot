# Finding Schema + Severity Rubric

This is the strict format every reviewer must emit and the consolidator must validate against.

## JSON schema

Each `subagent-N.json` is a JSON array. Each element is an object with **exactly** these keys:

```json
{
  "id":            "R<N>-<NNN>",
  "title":         "<= 80 chars>",
  "severity":      "critical|high|medium|low|info",
  "category":      "access-control|correctness|arithmetic|object-model|versioning|integration-boundary|events|move-quality|testing|scripts|docs",
  "file":          "sources/pas_transfer.move",
  "line_range":    "45-48",
  "description":   "...",
  "impact":        "...",
  "recommendation":"...",
  "evidence":      "<copy-paste quote from the file, minimum one full line>",
  "confidence":    "high|medium|low"
}
```

### Field requirements

- `id` — prefix `R<N>` where `<N>` is the reviewer number 1..5 (or `R0` for leader backfill). Example: `R3-007`.
- `title` — ≤ 80 characters; one-line summary.
- `severity` — exactly one of the five rubric values below.
- `category` — exactly one of the eleven category strings. Pick the best fit; do not invent new categories.
- `file` — path relative to repo root (no leading `./`).
- `line_range` — either `N` (single line) or `N-M` (inclusive range, M ≥ N).
- `description` — what is wrong / suspicious.
- `impact` — concrete consequence. For criticals: name the attacker, the call sequence, what they gain.
- `recommendation` — specific, actionable instruction. Either a code change, a check to add, or a test to write.
- `evidence` — **literal quote** from the cited file, minimum one full line. No paraphrase, no ellipsis. If quoting the upstream dep, include the upstream file path in the evidence body.
- `confidence` — your subjective confidence in the finding (high / medium / low).

All string fields must be non-empty.

## Severity rubric

| Level | Use when |
|---|---|
| **critical** | Loss of funds, bypass of compliance / authorization controls, broken authorization boundary, lost upgrade path, or any flaw that immediately compromises the protocol. Reserve for findings where the adversary path can be described concretely. |
| **high** | Incorrect behaviour on the golden path, missing check that enables misuse, state corruption under legitimate call sequences, or a design flaw that materially weakens security/operations. |
| **medium** | Correctness ambiguity, missing event/error, unsafe default, fragile dependency on upstream behaviour, test gaps for critical paths, or operational issues that don't immediately enable misuse. |
| **low** | Style / idiom drift from Move 2024, redundant abilities, naming inconsistencies, non-essential test gaps, code-quality polish. |
| **info** | Observations, doc suggestions, follow-ups not blocking merge, design notes. |

## Category cheatsheet

- **access-control** — auth proofs, RBAC, permission checks, cap usage.
- **correctness** — logic bugs, wrong assertions, incorrect state transitions.
- **arithmetic** — overflow / underflow / precision loss / division semantics.
- **object-model** — DOF / DF usage, ownership, sharing, derivation, lifecycle.
- **versioning** — package version gates, migration paths, dep pin issues at the call-site level.
- **integration-boundary** — Hadron-style ↔ external-dep call mismatches, signature drift, witness conventions.
- **events** — missing events, wrong event types, audit-trail gaps.
- **move-quality** — Move 2024 idioms, unused abilities, edition-beta usage, naming.
- **testing** — missing or weak tests, untested critical paths.
- **scripts** — TypeScript / off-chain script issues, SDK usage, deploy fragility.
- **docs** — README / module doc / inline comment accuracy.

## Anti-patterns (will be rejected by the consolidator)

- Empty fields.
- `evidence` that paraphrases instead of quoting.
- `id` collisions across reviewers (R<N> prefix prevents this).
- Severity inflation without a concrete adversary path (criticals especially).
- Findings on out-of-scope files (consolidator ignores these).
- Multiple distinct concerns packed into one finding — file separately.
