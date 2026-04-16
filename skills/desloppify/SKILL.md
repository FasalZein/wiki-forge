---
name: desloppify
description: >
  Code quality scanner that detects AI-introduced anti-patterns.
  Runs as the final step after /wiki closeout — scan, triage, fix, verify.
  Trigger: desloppify, clean up code, remove slop, code quality.
---

# Desloppify

CLI detects AI-introduced anti-patterns. You triage and fix. This is the **final quality gate** in the forge pipeline — it runs after `/wiki` closeout and before declaring work complete.

## Position in Pipeline

```text
/tdd -> /wiki closeout -> /improve-codebase-architecture (cadence) -> /desloppify -> done
```

Desloppify is the last step for both non-trivial and small-scope workflows. No code ships with unaddressed slop.

`/improve-codebase-architecture` sits directly before desloppify on non-trivial flows and runs at cadence boundaries (end of a PRD, batch of slices, weekly minimum). It catches module-shape problems; desloppify catches line-level ones. Running them in that order means desloppify evaluates a structurally sound target. Skip the architecture step for small-scope (<50 line) runs.

## When to Use

- **Always** — as the final step after `/wiki` closeout in the forge pipeline
- After any code change, before declaring a slice complete
- When user says "desloppify", "clean up code", "remove slop", "code quality"
- Before a release or code review
- After AI-assisted development sprints

## Workflow

```text
1. Scan       -> run CLI, review output
2. Triage     -> decide Fix / Skip / Flag per issue
3. Fix        -> fix issues directly (or use sub-agents for large batches)
4. Verify     -> re-scan, confirm score improved or maintained
5. Test       -> run full test suite after fixes (TDD is non-negotiable)
```

### Step 1: Scan

```bash
desloppify scan [path]                    # terminal report
desloppify scan [path] --json             # machine-readable
desloppify scan [path] --category <id>    # single category
desloppify score [path]                   # weighted quality grade
desloppify check-tools                    # available analyzers
```

### Step 2: Triage

For each issue, decide:
- **Fix** — real slop, fix it now
- **Skip** — by design, intentional pattern (add `// desloppify:ignore RULE_ID` comment)
- **Flag-only** — public API, dynamic access, serialization — never auto-fix

Categories and what they mean:

| Category | What it catches | Action |
|----------|----------------|--------|
| `ai-slop` | Lifecycle logs, redundant booleans, placeholder names | Fix — these are debugging residue |
| `complexity` | Nested ternaries, too many imports, large files | Fix or extract — simplify |
| `test-quality` | Weak assertions (toBeDefined vs actual value) | Fix — strengthen assertions |
| `runtime-validation` | JSON.parse without validation, untyped casts | Fix — add runtime checks |
| `circular-deps` | Circular imports | Fix — extract shared types or invert |
| `naming-semantics` | Numeric suffixes, meaningless names | Fix — rename to be descriptive |
| `inconsistency` | Scattered process.env, mixed patterns | Fix — centralize |

### Step 3: Fix

Fix issues directly in the code. For large batches, group by category and fix systematically.

**Rules for fixing:**
- Every fix must preserve existing test behavior — run tests after each category
- Don't introduce new patterns that create different slop
- Nested ternaries -> if/else (not another clever one-liner)
- Weak assertions -> assert on actual values (not just `.toBeDefined()`)
- JSON.parse -> validate the parsed shape before casting

For mechanical fixes:
```bash
desloppify fix [path] --safe              # Tier 1: comment removal, etc.
```

### Step 4: Verify

```bash
desloppify scan [path]                    # confirm issues are resolved
desloppify score [path]                   # verify score improved
bun test                                  # TDD gate: all tests still pass
```

**The score must not regress.** If you introduced code that lowers the score, fix it before closing.

## Safety Tiers

- **T1** — Mechanical fixes (comment removal). Git checkpoint only.
- **T2** — AST-validated fixes (empty catch, type casts). AST re-parse.
- **T3** — Cross-file fixes (dead code, type consolidation). Type checker / build.
- **Flag-only** — Public API, dynamic access, serialization. Never auto-fixed.

## Integration with Wiki

After desloppify fixes, if any source files changed:
- Tests must still pass (non-negotiable)
- `wiki gate` must still pass
- No need to re-run the full wiki closeout — desloppify is a quality polish, not a behavior change

## Suppression

When an issue is intentional:
```bash
console.log("intentional"); // desloppify:ignore CONSOLE_LOG
```

Project-level: `.desloppifyignore` (gitignore syntax).
