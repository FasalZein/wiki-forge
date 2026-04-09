---
name: forge
description: >
  Build with rigor. Enforces research → grill → PRD → slices → TDD before anything ships.
  Loads companion skills and checks gates. Zero API calls — everything stays in the wiki vault.
---

# Forge

Every non-trivial change follows this order. No exceptions.

```text
research → grill-me → PRD → slices → TDD → wiki verify
```

## Companion Skills

Load these in order before writing production code:

| Step | Invoke | Purpose |
|------|--------|---------|
| 1 | `/research` | Gather evidence, compare options, validate assumptions |
| 2 | `/grill-me` | Stress-test the plan — resolve ambiguities before committing |
| 3 | `/write-a-prd` | Capture problem, scope, modules, acceptance criteria |
| 4 | `/prd-to-slices` | Break PRD into tracer-bullet vertical slices in the wiki backlog |
| 5 | `/tdd` | Red-green-refactor for each slice |
| 6 | `/wiki` | File artifacts, verify pages, run gate |

If a skill is unavailable, stop and tell the user. Do not silently skip steps.

**Note:** `/prd-to-issues` (GitHub variant) exists for projects needing external issue tracking. For solo or agent-driven work, `/prd-to-slices` is faster and token-free.

## What Counts as Non-Trivial

Any change that adds or modifies behavior visible to users or other modules.

**Skip the full workflow only for:**
- Bug fixes under ~50 lines of diff
- Config or dependency changes
- Docs-only changes

When in doubt, start the workflow. Scaffolding a PRD takes 2 minutes.

## Hard Gates

1. **No code without tests.** Every code change needs changed tests, or a documented exception in the wiki.
2. **Run `wiki gate` before declaring done.** It blocks on missing tests.
3. **PRD + slicing before non-trivial implementation.**
4. **Research before PRD.** File with `wiki file-research` so decisions are traceable.
5. **Grill before PRD.** Stress-test assumptions — don't commit to a spec you haven't defended.
6. **Read code before updating wiki.** Never write docs from memory alone.
7. **No unmaintainable code.** If a slice passes tests but worsens maintainability, refactor before closing.

## Definition of Done

A slice is complete only when all of these are true:

1. Tests exist and pass for the changed behavior.
2. `wiki gate <project> --repo <path> --base <rev>` passes (exit 0).
3. Impacted wiki pages are updated from code and tests.
4. `wiki lint <project>` and `wiki lint-semantic <project>` pass.
5. Changed pages are re-verified with `wiki verify-page` at `code-verified` or `test-verified`.

## Workflow: Build or Change a Feature

```text
1. /research — gather evidence, file with: wiki file-research <project> <title>
2. /grill-me — defend the approach, resolve unknowns
3. /write-a-prd — capture scope, link to research in Prior Research section
4. /prd-to-slices — break into vertical slices (wiki create-issue-slice per slice)
5. /tdd — for each slice:
   a. Write failing tests first
   b. Make them pass with minimal code
   c. Refactor
   d. Run tests
6. /wiki — after each slice:
   a. wiki refresh-from-git <project> --base <rev>
   b. wiki drift-check <project> --show-unbound
   c. Update impacted wiki pages from code
   d. wiki verify-page <project> <page> code-verified
   e. wiki gate <project> --repo <path> --base <rev>
```

## Workflow: Bug Fix (< 50 lines)

```text
1. /tdd — write a failing test that reproduces the bug
2. Fix the code, make the test pass
3. wiki gate <project> --repo <path> --base <rev>
```

## Source of Truth

- **Existing code** is the source of truth for implemented behavior.
- **PRDs + slices + test plans** are the source of intent for greenfield work.
- **The wiki** is compiled memory — maintained from code, never the other way around.
- **Research** is evidence backing decisions — filed in the vault for traceability.
