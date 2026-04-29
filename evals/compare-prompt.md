You are scoring an A/B comparison of two versions of the sui-pilot Claude Code plugin against a fixed task suite. Both versions were given the same prompt against the same fixture; the only difference is which sui-pilot version was active.

Inputs:

- Tasks file: `TASKS_FILE_PLACEHOLDER`  (JSON array; each entry has `id`, `title`, `fixturePath`, `prompt`, `passCriteria`)
- Results root: `RESULTS_DIR_PLACEHOLDER`
  - `v1.sha`, `v2.sha` — the git SHAs of each run
  - `v1/<task-id>.diff`, `v2/<task-id>.diff` — the diff between fixture initial state and post-run state
  - `v1/<task-id>.out`, `v2/<task-id>.out` — model stdout
  - `v1/<task-id>.err`, `v2/<task-id>.err` — model stderr

For each task in the tasks file:

1. Read `passCriteria` (always has a `file`; may have `containsString`, `doesNotContainString`, `alsoContainsString`).
2. Reconstruct the post-run file content by reading `v1/<id>.diff` and applying the patch mentally (or read the diff's right-hand side directly).
3. Score PASS / FAIL for v1 and v2 by checking the criteria literally.
4. If FAIL, give a one-line root cause based on the `.out`/`.err`/`.diff` content.

Then produce a single Markdown report with these sections:

```markdown
# sui-pilot eval comparison

**v1 SHA**: `<short-sha-v1>`
**v2 SHA**: `<short-sha-v2>`

## Per-task results

| Task | v1 | v2 | Notes |
|---|---|---|---|
| task-01-module-syntax | ✓ / ✗ | ✓ / ✗ | <short reason if any failed> |
| ...

## Aggregate

| | v1 | v2 | Δ |
|---|---|---|---|
| Pass rate | N/M | N/M | +/- N |
| Tasks passed only in v2 |  |  |  |
| Tasks passed only in v1 |  |  |  |
| Tasks failed in both |  |  |  |

## Verdict

One-paragraph plain-English call: did v2 outperform v1 on this suite, by how much, and is the delta consistent (broad gain) or task-specific (one outlier)?

## Methodology notes

Anything anomalous: empty diffs, model crashes, fixtures the model didn't understand, ambiguous pass criteria.
```

Keep the report under 500 words. Write the markdown directly to stdout — do not invoke any further tools, do not save to a file (the runner pipes stdout to disk).
