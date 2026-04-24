# Non-Compliant Workflow Transcript

This fixture demonstrates a **violation** of the sui-move-agent workflow: the agent
writes code *before* consulting the bundled documentation. This is the detectable
anti-pattern that compliance auditing should flag.

---

## Scenario

User asks the sui-move-agent to implement a simple `Counter` object. The agent
proceeds directly to implementation without reading docs first.

---

## Transcript

**User:** Implement a `Counter` object in Move 2024 that tracks an integer count. Expose `increment`, `decrement`, and `value` functions.

---

**sui-move-agent:**

I'll implement the Counter for you.

### Step 1 — Implementation (VIOLATION: no doc lookup first)

```move
module counter::counter {

    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::transfer;

    struct Counter has key, store {
        id: UID,
        value: u64,
    }

    public fun new(ctx: &mut TxContext): Counter {
        Counter {
            id: object::new(ctx),
            value: 0,
        }
    }

    public fun get_value(c: &Counter): u64 {
        c.value
    }

    public fun increment(c: &mut Counter) {
        c.value = c.value + 1;
    }

    public fun decrement(c: &mut Counter) {
        assert!(c.value > 0, 0);
        c.value = c.value - 1;
    }
}
```

### Step 2 — Build verification

> `sui move build`

Build succeeded.

---

### Step 3 — Read docs (too late)

> Read `${CLAUDE_PLUGIN_ROOT}/docs/CLAUDE.md`

Found: preferred module syntax is `module package_name::name;` (no curly braces), edition 2024.

**Issues detected:**
- Module uses legacy syntax with curly braces
- `struct Counter` should be `public struct Counter`
- `get_value` should be `value` (no `get_` prefix per style guide)

---

## Why This Is Non-Compliant

The agent violated the **doc-first workflow** by writing code before reading the documentation:

| Step | Action | Violation |
|------|--------|-----------|
| 1 | Wrote implementation | Code written BEFORE any doc/grep |
| 2 | Built code | Build attempted without doc verification |
| 3 | Read docs | Too late - docs read AFTER code exists |

### Detectable Signals

An audit tool can detect this violation by checking:

1. **Tool call ordering**: `Edit`/`Write` tool calls appear before any `Read` or `Grep` calls targeting the `docs/` directory
2. **Missing doc citations**: No reference to `docs/CLAUDE.md` or the doc index embedded in `docs/agents/sui-pilot-agent.md` before the first code block
3. **No bundled doc search**: No `Grep` calls against `.sui-docs/`, `.walrus-docs/`, `.seal-docs/`, or `.ts-sdk-docs/` before implementation

### Correct Ordering Should Be

1. Read `docs/CLAUDE.md` for project conventions
2. Read `docs/agents/sui-pilot-agent.md` for the embedded doc index and sui-pilot routing
3. Grep bundled docs for relevant patterns (`.sui-docs/`, `.walrus-docs/`, `.seal-docs/`, `.ts-sdk-docs/`)
4. **Then** write implementation
5. Run `/move-code-quality`
6. Run `/move-code-review`
7. Run `/move-tests` if needed

---

## Code Quality Issues (would have been caught)

Because docs were not consulted first, the implementation has these issues:

| Issue | Expected | Actual |
|-------|----------|--------|
| Module syntax | `module counter::counter;` | `module counter::counter { }` |
| Struct visibility | `public struct Counter` | `struct Counter` |
| Getter naming | `value()` | `get_value()` |
| Error constant | Named constant `EUnderflow` | Bare `0` |

These would have been avoided if the agent had read the docs first.

---

## Compliance Checklist

| Criterion | Satisfied |
|---|---|
| (a) Doc lookup in `docs/CLAUDE.md` before code | :x: Violated |
| (b) Doc lookup in `docs/agents/sui-pilot-agent.md` index before code | :x: Violated |
| (c) Grep bundled docs before code | :x: Violated |
| (d) Code implementation after docs | :x: Code came first |
| (e) `/move-code-quality` invoked | :x: Not invoked |
| (f) `/move-code-review` invoked | :x: Not invoked |
| (g) `/move-tests` invoked | :x: Not invoked |
