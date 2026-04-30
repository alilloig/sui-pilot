# Hook tests (stub)

Vitest fixtures for the hooks pipeline. v0 ships an empty harness; populate with:

- `fixtures/move-package/` — bare Move 2024 package (`Move.toml` + `sources/example.move`).
  Expected: `move-code-quality`, `move-code-review`, `move-tests` injected on Edit of `*.move`.
- `fixtures/sui-dapp/` — TS file importing `@mysten/sui` v2.
  Expected: `move-code-review` skill matches via `importPatterns`; SDK 2.0 prompt phrase escalates priority.
- `fixtures/walrus-app/` — file referencing `@mysten/walrus`.
  Expected: Walrus chunk extraction works; no skill match (no Walrus skill yet) but the chunk should resolve via `sui-context`.
- `fixtures/seal-app/` — file referencing `@mysten/seal`.
  Expected: similar to Walrus — chunk extraction succeeds.

Test layout (target):

```
hooks/test/
├── fixtures/
│   ├── move-package/
│   ├── sui-dapp/
│   ├── walrus-app/
│   └── seal-app/
├── pretooluse-skill-inject.test.ts
├── user-prompt-submit-skill-inject.test.ts
├── session-start-profiler.test.ts
├── inject-sui-context.test.ts
└── sui-context.test.ts
```

Each test should:
1. Set `CLAUDE_PROJECT_ROOT` to the fixture path.
2. Build a synthetic hook input (PreToolUse Edit of a known file, UserPromptSubmit with a known prompt).
3. Run the compiled `.mjs` via `node` subprocess (or import directly in vitest if pure).
4. Assert the stdout content matches a snapshot (or specific substring).

Snapshot conventions: store under `hooks/test/__snapshots__/`; rerun with `pnpm test --update-snapshots` when the matchers/budgets change intentionally.

Run:
```bash
pnpm --dir hooks test
```
