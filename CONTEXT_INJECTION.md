# Context Injection Walkthrough

Step-by-step trace of every piece of context that lands in a Claude Code session running sui-pilot. ASCII diagrams + the smallest concrete trace per step. Read top to bottom — the steps are time-ordered.

---

## Big picture

```
   Plugin             SessionStart          UserPrompt           PreToolUse           SessionEnd
   install            (×3 hooks)            Submit               (per tool call)
 ────────────       ────────────          ────────────         ─────────────         ──────────
                      │   │   │              │                       │                   │
                      ▼   ▼   ▼              ▼                       ▼                   ▼
                  ┌───────────────┐    ┌───────────────┐      ┌─────────────────┐   ┌─────────┐
                  │ seen-skills   │    │ score user    │      │ match path/bash/│   │ rm -rf  │
                  │ profiler      │    │ prompt vs     │      │ import vs       │   │ /tmp/   │
                  │ inject-sui-   │    │ promptSignals │      │ manifest        │   │ sui-    │
                  │ context       │    │ → top 2       │      │ → top 3         │   │ pilot-* │
                  └───────┬───────┘    └───────┬───────┘      └────────┬────────┘   └─────────┘
                          │                    │                       │
                  ≤ ~600 B + env vars   ≤ 8 KB skills+chunks   ≤ 18 KB skills+chunks
                          │
                  always-loaded:
                  agents/sui-pilot-agent.md (~2.9 KB) — loaded by Claude Code's @-import,
                  not by hooks. The only context that's there before any hook fires.
```

Three things to internalize:
- **The always-loaded preamble is tiny** (~2.9 KB / ~550 tokens). Everything else loads on demand.
- **Hooks fire in event order, not all at once.** SessionStart runs once per boot; PreToolUse runs *every* tool call.
- **Dedup is session-scoped.** A skill or chunk that's been injected once won't be re-injected unless the session is `clear`ed or `compact`ed.

---

## Step 0 — Plugin install + first boot

```
$ /plugin install sui-pilot@contract-hero
        │
        ▼
~/.claude/plugins/cache/sui-pilot/   ← entire plugin tree copied here
        │
        ▼
$ <restart Claude Code>
        │
        ▼
Claude Code reads .claude-plugin/plugin.json
        │
        ├──▶ spawns child process: node mcp/move-lsp-mcp/dist/index.js
        │     (MCP server, exposes 4 tools over stdio)
        │
        ├──▶ reads hooks/hooks.json
        │     (6 hook scripts registered at 4 events)
        │
        └──▶ resolves @-import: agents/sui-pilot-agent.md
              (loaded into the system prompt; always-loaded from now on)
```

Nothing user-visible happens yet. Three artifacts now exist in process memory:
1. The MCP server child process, idle, ready to accept tool calls.
2. The hook registrations in Claude Code's event router.
3. The slim doc-first directive in the system prompt.

---

## Step 1 — SessionStart fires

This event matches `startup|resume|clear|compact`. Three hooks run in series, one after the other. Their stdouts are accumulated into "additional context" for the upcoming model turn.

```
SessionStart event
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ 1. session-start-seen-skills.mjs                                   │
│    purpose: reset session-scoped dedup state                       │
│                                                                    │
│    rm -rf /tmp/sui-pilot-<sessionId>-seen-skills.d/                │
│    rm -rf /tmp/sui-pilot-<sessionId>-seen-context-chunks.d/        │
│                                                                    │
│    stdout: (empty)                                                 │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2. session-start-profiler.mjs                                      │
│    purpose: figure out what kind of project this is                │
│                                                                    │
│    scans cwd for:                                                  │
│      ├── Move.toml, *.move, sources/, tests/   → Move skills       │
│      ├── package.json deps starting "@mysten/" → SDK skills        │
│      └── (empty dir or only dot-files)         → greenfield        │
│                                                                    │
│    computes likelySkills = ["move-code-quality",                   │
│                             "move-code-review",                    │
│                             "move-tests"]                          │
│                                                                    │
│    setSessionEnv("SUI_PILOT_LIKELY_SKILLS", likelySkills.join(","))│
│      └─▶ appends to ${CLAUDE_ENV_FILE}                             │
│           which Claude Code sources before subsequent hooks        │
│                                                                    │
│    stdout: (greenfield message if applicable, else empty)          │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ 3. inject-sui-context.mjs                                          │
│    purpose: tell the model "your training is stale, read docs"     │
│                                                                    │
│    cat sui-session.md (~600 B)                                     │
│    stdout: <the file contents>                                     │
│                                                                    │
│    Claude Code adds stdout to the model's additional context.      │
└────────────────────────────────────────────────────────────────────┘

Total bytes injected this step: ~600 B (the sui-session.md content).
Total bytes already in system prompt: ~2.9 KB (sui-pilot-agent.md, from @-import).
```

The model's first turn now has: `sui-pilot-agent.md` (always-loaded) + `sui-session.md` (just injected).

---

## Step 2 — User submits the first prompt

```
User: "Implement a deposit function in sources/pool.move using the
       capability pattern. Make sure it's safe."
        │
        ▼
UserPromptSubmit event fires
        │
        ▼
user-prompt-submit-skill-inject.mjs
```

Inside the hook, this scoring loop runs once per skill in `generated/skill-manifest.json`:

```
for skill in manifest.skills:
    score = 0
    promptSignals = skill.promptSignals
                  = { phrases, allOf, anyOf, noneOf, minScore }

    normalized = lowercase + expand contractions + collapse whitespace

    ┌──────────────────────────────────────────────────────────┐
    │ phrases ── for each phrase, if normalized contains it:   │
    │             score += 6                                   │
    │                                                          │
    │ allOf ───── for each conjunction (a list of terms),      │
    │             if ALL terms in normalized: score += 4       │
    │                                                          │
    │ anyOf ───── for each term in anyOf,                      │
    │             if normalized contains it: score += 1        │
    │             (capped at +2 total per skill)               │
    │                                                          │
    │ noneOf ──── if any term in normalized:                   │
    │             score = -∞ (hard veto)                       │
    └──────────────────────────────────────────────────────────┘

    if skill.slug in env.SUI_PILOT_LIKELY_SKILLS:
        score += 5     ← profiler boost from Step 1

    if score >= promptSignals.minScore:
        candidates.push({ skill, score })
```

Concrete trace for our prompt:

```
prompt (normalized): "implement a deposit function in sources/pool.move
                     using the capability pattern. make sure it is safe."

skill: move-code-review
    phrases:    ["security review", "audit", "is this safe", ...]
                  ↑ none hit (the prompt says "is safe" not "is this safe")
    allOf:      [["move", "security"], ["audit", "contract"]]
                  ↑ none of the conjunctions are fully satisfied
    anyOf:      ["overflow", "access control", "shared object",
                 "blind transfer", "capability", "publish"]
                  ↑ "capability" hits → +1
    noneOf:     []
    boost:      +5 (in SUI_PILOT_LIKELY_SKILLS)
    raw score:  6
    minScore:   6
    → CANDIDATE

skill: move-code-quality
    phrases:    none hit
    anyOf:      ["idiom", "syntax", "edition", "best practice"] → none hit
    boost:      +5
    raw score:  5
    minScore:   6
    → DROPPED (below threshold)
```

Then:

```
sort candidates by score → [move-code-review (score=6)]
                              │
                              ▼
applyDedup ── is move-code-review in /tmp/.../seen-skills.d/?
              │  no  →  pass through
              │
              ▼
applyBudget ── accumulate body bytes (skills/move-code-review/SKILL.md)
              ─ move-code-review body ≈ 23 KB
              ─ caps at SUI_PILOT_PROMPT_INJECTION_BUDGET=8000
              ─ truncated to fit budget
              │
              ▼
extractSuiContextChunk(skill="move-code-review")
              │
              │  SKILL_TO_CHUNK["move-code-review"]
              │      = { chunkId: "sui-object-model",
              │          heading: "Sui object model" }
              │
              ▼
              read sui.md, extract section by heading match
              wrap in <!-- sui-context-chunk:sui-object-model --> ... <!-- /... -->
              cap at DEFAULT_CONTEXT_CHUNK_BUDGET_BYTES = 5000
              │
              ▼
              record "sui-object-model" in seen-context-chunks.d/

stdout: <move-code-review body, truncated> + <sui-object-model chunk>
record:  /tmp/sui-pilot-<sid>-seen-skills.d/move-code-review        ← touch
        /tmp/sui-pilot-<sid>-seen-context-chunks.d/sui-object-model ← touch
```

The model's second turn now has: always-loaded preamble + `sui-session.md` + the `move-code-review` skill body + the "Sui object model" chunk from `sui.md`.

---

## Step 3 — First tool call: Edit sources/pool.move

The model decides to edit the file. PreToolUse fires *before* the edit happens.

```
toolName  = "Edit"
toolInput = { file_path: "/Users/.../sources/pool.move", old_string, new_string }
        │
        ▼
PreToolUse event fires
        │
        ▼
pretooluse-skill-inject.mjs
```

Inside:

```
parseInput() → toolName, filePath, bashCommand, importsInFile
        │
        ▼
[MCP boost gate]
        │
        │  is toolName "mcp__sui-pilot__move-lsp__*"
        │  or "mcp__move-lsp__*" ?
        │     no  →  skip
        │     yes →  merge Move skills into SUI_PILOT_LIKELY_SKILLS
        │
        ▼
loadManifest(generated/skill-manifest.json)
        │
        ▼
for skill in manifest.skills:
    base = skill.priority   (e.g. move-code-quality = 5)
    if filePath matches any compiled pathRegexSources:   matches += 1
    if bashCommand matches any bashRegexSources:          matches += 1
    if any import in importsInFile matches importRegexSources: matches += 1

    if matches > 0:
        score = base
        if skill.slug in SUI_PILOT_LIKELY_SKILLS: score += 5
        candidates.push({ skill, score, matches })
```

Concrete trace:

```
filePath = "sources/pool.move"
bashCommand = "" (this is an Edit, not Bash)
importsInFile = []  (Move file, parser only extracts TS imports)

skill: move-code-quality
    pathPatterns: ["**/*.move", "**/Move.toml"]   ← "**/*.move" hits
    bashPatterns: [...]                            ← n/a, no bash
    importPatterns: []
    matches = 1
    base priority = 5
    boost = +5 (likely)
    score = 10

skill: move-code-review
    pathPatterns: ["**/*.move", "**/Move.toml"]   ← hits
    importPatterns: ["@mysten/sui"]                ← n/a (not TS)
    matches = 1
    base = 7
    boost = +5
    score = 12

skill: move-tests
    pathPatterns: ["**/tests/*.move", "**/*_tests.move"]  ← does NOT hit
                                                            (sources/, not tests/)
    matches = 0
    → not a candidate

skill: move-pr-review
    pathPatterns: ["**/*.move", "**/Move.toml"]   ← hits
    bashPatterns: ['\bgh\s+pr\s+(view|diff|...)\b']  ← n/a
    matches = 1
    base = 6
    boost = +5
    score = 11

skill: oz-math
    pathPatterns: ["**/*.move"]                   ← hits
    bashPatterns: []
    importPatterns: []   (cleared in v2 — Move regexes
                           don't fit the ESM template)
    matches = 1
    base = 5
    boost = (not in likely)
    score = 5
```

Continuing:

```
sort by score → [move-code-review(12), move-pr-review(11),
                 move-code-quality(10), oz-math(5)]
        │
        ▼
applyDedup
    move-code-review     → already in seen-skills.d/  → DROP
    move-pr-review       → not seen                   → keep
    move-code-quality    → not seen                   → keep
    oz-math              → not seen                   → keep
        │
        ▼
take top 3 → [move-pr-review, move-code-quality, oz-math]
        │
        ▼
applyBudget(SUI_PILOT_INJECTION_BUDGET=18000)
    accumulate skill bodies in priority order, stop at 18 KB
    │
    │  move-pr-review     ≈ 22 KB (alone — too big!) → truncate to fit
    │  → caps the injection at 1 skill, drops the others by budget
    │  (alternatively, smaller skills earlier would let multiple fit)
    │
    ▼
extractSuiContextChunk(top skill)
    SKILL_TO_CHUNK["move-pr-review"]
        = { chunkId: "transactions", heading: "Transactions & lifecycle" }
    extract section, wrap, dedup-check, cap at 5000 B

stdout: <move-pr-review body> + <Transactions & lifecycle chunk>
record:
  /tmp/.../seen-skills.d/move-pr-review                  ← touch
  /tmp/.../seen-context-chunks.d/transactions            ← touch
```

The model receives the additional context, *then* performs the Edit.

---

## Step 4 — MCP move-lsp boost

Suppose later the model invokes the diagnostics tool:

```
toolName = "mcp__sui-pilot__move-lsp__move_diagnostics"
        │
        ▼
PreToolUse event fires
        │
        ▼
pretooluse-skill-inject.mjs

[MCP boost gate fires this time]
        │
        ▼
existing = process.env.SUI_PILOT_LIKELY_SKILLS.split(",")
         = ["move-code-quality", "move-code-review", "move-tests"]
moveSkills = ["move-code-quality", "move-code-review", "move-tests"]
merged = unique(existing ∪ moveSkills)
process.env.SUI_PILOT_LIKELY_SKILLS = merged.join(",")
        │
        ▼
matcher pipeline runs as normal — but now move-tests has the boost too,
so a subsequent Edit of sources/pool.move (path-only matches move-tests via
**/tests/*.move? no — but...) actually doesn't change the example here
because move-tests' pathPatterns are tests-specific.

Where the boost matters: a *prompt* like "write tests" that previously
scored just below threshold now clears it because of the +5 boost.
```

The boost is transitive: once the LSP fires, every subsequent UserPromptSubmit and PreToolUse benefits, for the rest of the session.

---

## Step 5 — Subsequent tool call: dedup kicks in

The model edits `sources/pool.move` again, ten minutes later.

```
PreToolUse fires → matcher computes [move-code-review(12), move-pr-review(11),
                                     move-code-quality(10), ...]
        │
        ▼
applyDedup
    move-code-review   → seen   → DROP
    move-pr-review     → seen   → DROP
    move-code-quality  → seen   → DROP
    oz-math            → not    → keep
        │
        ▼
take top 3 of survivors → [oz-math]   (only one left!)
        │
        ▼
extractSuiContextChunk for oz-math
    SKILL_TO_CHUNK["oz-math"]
        = { chunkId: "onchain-finance", heading: "Onchain finance & math" }
    not yet in seen-context-chunks.d/  →  inject
    cap at 5000 B
        │
        ▼
stdout: <oz-math body> + <Onchain finance & math chunk>
```

In a long-running session you progressively saturate the dedup state — eventually all 5 skills are seen, and PreToolUse becomes a no-op (just runs the matcher and emits empty additional context). That's intentional: the same skill body in the model's context window twice is wasted tokens.

The session-scoped reset triggers are `/clear` and `/compact` — both fire SessionStart again, which wipes `seen-skills.d/` and `seen-context-chunks.d/`.

---

## Step 6 — SessionEnd

```
User exits Claude Code
        │
        ▼
SessionEnd event fires
        │
        ▼
session-end-cleanup.mjs

  rm -rf /tmp/sui-pilot-<sessionId>-seen-skills.d/
  rm -rf /tmp/sui-pilot-<sessionId>-seen-context-chunks.d/
  rm -f  /tmp/sui-pilot-<sessionId>-likely-skills.txt
  rm -f  /tmp/sui-pilot-<sessionId>-greenfield.txt
```

Disk is clean. Next `claude` invocation gets a fresh session ID and starts at Step 0.

---

## Reference: dedup file layout

```
/tmp/
  ├── sui-pilot-<sessionId>-seen-skills.d/        ← directory
  │     ├── move-code-review        ← empty file (presence = "injected")
  │     ├── move-pr-review
  │     ├── move-code-quality
  │     └── oz-math
  │
  ├── sui-pilot-<sessionId>-seen-context-chunks.d/
  │     ├── sui-object-model
  │     ├── transactions
  │     ├── move-type-system
  │     └── onchain-finance
  │
  ├── sui-pilot-<sessionId>-likely-skills.txt     ← file (env var mirror)
  │     "move-code-quality,move-code-review,move-tests"
  │
  └── sui-pilot-<sessionId>-greenfield.txt
        "true" or ""
```

Atomic claim primitive: `openSync(path, "wx")` — fails with `EEXIST` if the file already exists. Lock-free, correct under concurrent hook invocations.

---

## Reference: byte budgets

| Where                                        | Cap   | Env var                              |
| -------------------------------------------- | ----- | ------------------------------------ |
| Always-loaded preamble                       | 4 KB  | (CI guard, not env)                  |
| SessionStart eager injection                 | none  | (`sui-session.md` is ~600 B; small)  |
| `PreToolUse` total injection                 | 18 KB | `SUI_PILOT_INJECTION_BUDGET`         |
| `UserPromptSubmit` total injection           | 8 KB  | `SUI_PILOT_PROMPT_INJECTION_BUDGET`  |
| Per-chunk extracted from `sui.md`            | 5 KB  | (constant in `sui-context.mts`)      |

The budgets compose: a single PreToolUse can inject up to 3 skill bodies (truncated to 18 KB total) + one sui.md chunk per top skill (each ≤ 5 KB).

---

## Reference: full SKILL_TO_CHUNK map

```
hooks/src/sui-context.mts:

  SKILL_TO_CHUNK = {
    "move-code-quality": { chunkId: "move-type-system",
                           heading:  "Move type system & abilities" },
    "move-code-review":  { chunkId: "sui-object-model",
                           heading:  "Sui object model" },
    "move-pr-review":    { chunkId: "transactions",
                           heading:  "Transactions & lifecycle" },
    "move-tests":        { chunkId: "tooling",
                           heading:  "Tooling" },
    "oz-math":           { chunkId: "onchain-finance",
                           heading:  "Onchain finance & math" },
  }
```

The mapping defines a bijection: one chunk per skill, one skill per chunk. If you flesh out a new section in `sui.md` and want a skill to point at it, this is the only place to add it.

---

## What lands in the model's context window — full recap

For a 10-minute session that opens a Move project and edits one file:

| Source                                   | Bytes (~) | Lifetime                          |
| ---------------------------------------- | --------: | --------------------------------- |
| `agents/sui-pilot-agent.md` (@-import)   |   2,900   | Always-loaded                     |
| `sui-session.md` (SessionStart)          |     600   | Once per session                  |
| `move-code-review` body (UserPromptSubmit) |   8,000   | Once (deduped after)              |
| "Sui object model" chunk (UserPromptSubmit) |   4,300   | Once (deduped after)              |
| `move-pr-review` body (PreToolUse #1)    |  18,000   | Once (capped at budget)           |
| "Transactions & lifecycle" chunk         |   1,000   | Once                              |
| `oz-math` body (PreToolUse #2)           |   8,000   | Once                              |
| "Onchain finance & math" chunk           |     800   | Once                              |
| **Total injected**                       | **~43 KB** | over the whole session            |

Compare to v1's `~5,345 tokens × every turn` always-loaded preamble: even a multi-turn session in v2 is cheaper than a single turn in v1.
