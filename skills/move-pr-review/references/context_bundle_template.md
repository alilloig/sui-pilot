# Context Bundle Template — `_context.md`

This is the structure the orchestrator uses to build `reviews/.raw/_context.md`. Adapt section by section based on what's available for the specific PR (Linear ticket may not exist; Notion docs may not be referenced; dep pins may not be relevant).

---

# PAS Integration Review — Shared Context Bundle

> Read this **completely** before reviewing. Single source of truth shared with all 9 other reviewers. The consolidator uses it to normalize findings.

## 1. Ticket

- **Linear ticket / GitHub issue:** `<ID>` — `<title>`
- **Assignee:** `<name>`
- **Status at review time:** `<status>`
- **Ask:** one-paragraph summary of what's being reviewed and what's NOT (out of scope).

(If no ticket: skip this section, replace with a one-paragraph "Review request" derived from PR body or user input.)

## 2. PR under review

- **Repo:** `<owner/repo>`
- **PR:** `#<N>` — `<title>`
- **Author:** `<github-handle>`
- **Base:** `<base-branch>`  **Head:** `<head-branch>`
- **HEAD commit:** `<sha>`
- **Diff size:** `+<additions>` / `−<deletions>` over `<N>` files.
- **Single commit?** yes / no — if multi-commit, list commit subjects.

## 3. Dep pins (capture for reproducibility)

For each Move git dep in `Move.toml`:
- `<dep-name>` pinned to `rev = "<value>"`. ⚠️ if `<value>` is a branch name, flag for the report.
- Local clone (if any) at `<path>` HEAD `<sha>`. **Reviewers MUST trust this HEAD as the upstream snapshot.** If a finding turns on upstream semantics, quote the local-clone file path.

## 4. Review scope — IN

All of these are in scope. Each reviewer MUST touch every file in this list at least once.

**New Move modules (audit fully):**
- `sources/<file>.move`
- ...

**Modifications to existing Move modules (audit the diff, not the whole file):**
- `sources/<file>.move` — what changed
- ...

**New / modified packages:**
- `sub-package/Move.toml`
- `sub-package/sources/<file>.move`

**Off-chain code (audit fully):**
- `scripts/src/...`

**Configuration / manifest:**
- `Move.toml`, `package.json` deltas only.

## 5. Review scope — OUT (read for context only)

DO NOT file findings on these files; they are pre-existing / under separate audit. Read only if needed to understand an integration boundary.

- `sources/<file>.move` — `<reason>`
- ...

## 6. Upstream dep surface to cross-check

| Hadron call-site | Upstream symbol | Upstream file (read-only) |
|---|---|---|
| `<hadron-module>::<fn>` | `<dep>::<symbol>` | `<absolute-path>` |
| ... | ... | ... |

For any finding that turns on upstream semantics, quote the upstream file path in `evidence`.

## 7. Design intent (from Linear / Notion / docs)

### 7.1 `<doc-name>` — distilled

(Up to 60 lines per doc. Focus on: invariants, intended actor boundaries, threat model, design decisions. Cite doc URLs for traceability.)

> **Spec drift note:** if the doc says X and code does Y, mention it here. Reviewers may flag spec drift as info-level findings.

### 7.2 `<another-doc>` — distilled

...

## 8. Finding schema (STRICT — validator runs on each artifact)

(Embed `references/finding_schema.md` content here verbatim, OR reference it: "See `${CLAUDE_PLUGIN_ROOT}/skills/move-pr-review/references/finding_schema.md` for the strict schema.")

## 9. Severity rubric

(Embed the rubric from `finding_schema.md` here verbatim.)

## 10. LEADS — confirm, refute, or ignore (DO NOT TRUST)

Things the orchestrator noticed during pre-read. **NOT** findings — confirm with independent evidence, refute, or ignore. The leads list serves only as a sanity check against blind spots; reviewers are graded on independent contribution.

1. <one-line lead>
2. <one-line lead>
...

## 11. Working directory & prohibitions

- **cwd:** `<absolute-path-to-Hadron-repo>`. Upstream dep at `<path>` (READ-ONLY).
- **NO** edits to Move / TS code, manifests, or anything outside `reviews/.raw/subagent-<N>.json`.
- **NO** `sui move build`, `forge`, `pnpm install`, `git commit`, `git push`, mutating `gh` commands.
- **DO** invoke `move-code-review` and `move-code-quality` skills.
- **DO** read upstream files to validate integration boundaries.

## 12. Budget

- Target ~30–45 minutes per reviewer.
- Target 10–30 findings. Quality > quantity.
- Emit what you have if you run out of budget.
