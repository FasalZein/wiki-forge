---
name: tdd
description: >
  Test-driven development with red-green-refactor loop, integrated with the wiki slice lifecycle.
  Use when building features, fixing bugs, or implementing slices using TDD.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means. The warning sign: your test breaks when you refactor, but behavior hasn't changed.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces bad tests:
- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You test the _shape_ of things rather than user-facing behavior
- Tests become insensitive to real changes
- You commit to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test, one implementation, repeat. Each test responds to what you learned from the previous cycle.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED->GREEN: test1->impl1
  RED->GREEN: test2->impl2
  RED->GREEN: test3->impl3
```

## Execution Modes

### Non-trivial (inside /forge pipeline)

When implementing a wiki-tracked slice, TDD runs after slice docs are filled:

```text
wiki start-slice <project> <slice-id> --agent <name> --repo <path>
  -> fill plan.md and test-plan.md
  -> /tdd (this skill)
  -> /wiki closeout sequence
```

The test-plan.md provides the initial red tests. Use it as input but don't be rigid — the TDD loop may discover behaviors not anticipated in the plan.

Before starting:
1. Read the slice's `plan.md` for scope and acceptance criteria
2. Read the slice's `test-plan.md` for planned red tests
3. Read the source code that will be modified
4. Confirm the interface design with the user

After TDD is complete, hand off to the `/wiki` closeout:
```bash
wiki checkpoint <project> --repo <path>
wiki lint-repo <project> --repo <path>
wiki maintain <project> --repo <path> --base <rev>
# update impacted wiki pages from code and tests
wiki verify-page <project> <page> code-verified
wiki verify-slice <project> <slice-id> --repo <path>
wiki closeout <project> --repo <path> --base <rev>
wiki gate <project> --repo <path> --base <rev>
wiki close-slice <project> <slice-id> --repo <path> --base <rev>
```

### Small scope (bug fix / focused refactor)

For changes under ~50 lines that skip the full forge pipeline:

```text
/tdd -> /wiki (checkpoint, lint-repo, maintain, verify-page, gate)
```

No PRD, no slicing, no slice lifecycle. Just write the failing test, fix the code, verify the wiki.

### Standalone (no wiki)

For projects not using the wiki system, TDD works the same — just skip the wiki closeout steps.

## Workflow

### 1. Planning

Before writing any code:

- Confirm with user what interface changes are needed
- Confirm which behaviors to test (prioritize — you can't test everything)
- Identify opportunities for [deep modules](deep-modules.md)
- Design interfaces for [testability](interface-design.md)
- List the behaviors to test (not implementation steps)

Ask: "What should the public interface look like? Which behaviors are most important to test?"

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior -> test fails
GREEN: Write minimal code to pass -> test passes
```

This proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test -> fails
GREEN: Minimal code to pass -> passes
```

Rules:
- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](refactoring.md):

- Extract duplication
- Deepen modules (move complexity behind simple interfaces) — see [deep-modules.md](deep-modules.md). Deepening opportunities that span multiple modules are out of scope for TDD; capture them and run `/improve-codebase-architecture` at the end of the PRD or batch so they ship as their own tracked feature.
- Apply SOLID principles where natural
- Consider what new code reveals about existing code
- Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

### 5. Verify (wiki-tracked work)

After TDD completes, run verification commands from the test-plan:

```bash
# Commands listed in test-plan.md ## Verification Commands
bun test
bun run typecheck
```

If `wiki verify-slice` is available, it runs these automatically and promotes the test-plan to `test-verified`.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```

## Mocking Rules

Mock at **system boundaries** only:
- External APIs (payment, email, third-party services)
- Databases (prefer test DB when possible)
- Time/randomness
- File system (sometimes)

**Never mock** your own modules, internal collaborators, or anything you control. See [mocking.md](mocking.md) for details.

## Interface Design for Testability

1. **Accept dependencies, don't create them** — dependency injection
2. **Return results, don't produce side effects** — pure functions where possible
3. **Small surface area** — fewer methods = fewer tests needed

See [interface-design.md](interface-design.md) for examples.

## Hard Gate

**No code without tests. No exceptions. Ever.**

Every code change MUST have corresponding tests. This is non-negotiable:
- "It's too simple to test" — test it anyway.
- "It's just a refactor" — prove it with tests.
- "I'll add tests later" — no. Tests come first. That's what TDD means.
- "It's just config/types" — if it can break, it needs a test.

`wiki gate` enforces this — it hard-blocks on missing tests for changed files. The gate does not accept excuses.

After TDD + `/wiki` closeout, run `/improve-codebase-architecture` at cadence boundaries (end of a PRD, batch of slices, or at least weekly) and then `/desloppify` to catch AI-introduced anti-patterns:
```bash
desloppify scan .        # detect slop
desloppify score .       # verify no regression
```
