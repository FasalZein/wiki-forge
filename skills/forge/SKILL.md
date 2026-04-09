---
name: forge
description: >
  Build with rigor. Orchestrates research → grill → PRD → slices → TDD before anything ships.
  Forge is the workflow layer, not the research layer or wiki layer. It loads companion skills and checks gates. Zero API calls — everything stays in the wiki vault.
---

# Forge

Forge is the workflow layer. It coordinates separate companion layers:
- research = actual evidence gathering and option comparison
- wiki = maintained knowledge and verification
- forge = delivery policy tying them together

Every non-trivial change follows this order. No exceptions.

```text
research → grill-me → PRD → slices → TDD → wiki verify
```

## Companion Skills

Install these before relying on `/forge`:

```bash
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
npx skills@latest add ./skills/prd-to-slices -g
npx skills@latest add ./skills/wiki -g
```

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

Use forge only when the task actually needs the forge pipeline.

Trigger `/forge` for work like:
- a new feature or workflow
- behavior that crosses module boundaries
- changes that need research or design tradeoffs
- work likely to become a tracked slice/backlog item
- anything that should leave PRD + slice history in the wiki

Do **not** trigger `/forge` for:
- bug fixes under ~50 lines of diff
- small focused refactors
- config or dependency changes
- docs-only changes
- wiki formatting / note cleanup
- repo exploration or code reading

For smaller tasks, use the smallest fitting workflow instead:
- code fix: `/tdd` + `/wiki`
- wiki/note work: `/wiki` + `/obsidian-markdown`
- exploration: `/wiki`

When in doubt, ask: "does this need research → PRD → slices?" If not, don't use forge.

## Hard Gates

1. **No code without tests.** Every code change needs changed tests, or a documented exception in the wiki.
2. **Run `wiki gate` before declaring done.** It blocks on missing tests.
3. **PRD + slicing before non-trivial implementation.**
4. **Research before PRD.** Run `/research` first, then file the result with `wiki research file` so decisions are traceable.
5. **Grill before PRD.** Stress-test assumptions — don't commit to a spec you haven't defended.
6. **Read code before updating wiki.** Never write docs from memory alone.
7. **No unmaintainable code.** If a slice passes tests but worsens maintainability, refactor before closing.
8. **Never create `.md` documentation inside project repos** except `README.md` and `CHANGELOG.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.

## Definition of Done

A slice is complete only when all of these are true:

1. Tests exist and pass for the changed behavior.
2. `wiki gate <project> --repo <path> --base <rev>` passes (exit 0).
3. Impacted wiki pages are updated from code and tests.
4. `wiki lint <project>` and `wiki lint-semantic <project>` pass.
5. Changed pages are re-verified with `wiki verify-page` at `code-verified` or `test-verified`.

## Workflow: Build or Change a Feature

```text
1. /research — gather evidence and decide; then file it with: wiki research file <project> <title>
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
   e. wiki lint <project>
   f. wiki lint-semantic <project>
   g. wiki gate <project> --repo <path> --base <rev>
```

## Workflow: Small Task / Bug Fix (< 50 lines)

```text
1. /tdd — write a failing test that reproduces the bug
2. Fix the code, make the test pass
3. /wiki — closeout:
   a. wiki refresh-from-git <project> --base <rev>
   b. wiki drift-check <project> --show-unbound
   c. Update impacted wiki pages from code
   d. wiki verify-page <project> <page> code-verified
   e. wiki lint <project>
   f. wiki lint-semantic <project>
   g. wiki gate <project> --repo <path> --base <rev>
```

## Source of Truth

- **Existing code** is the source of truth for implemented behavior.
- **PRDs + slices + test plans** are the source of intent for greenfield work.
- **The wiki** is compiled memory — maintained from code, never the other way around.
- **Research** is evidence backing decisions. `/research` gathers it; `wiki research ...` files it in the vault for traceability.
- **Obsidian formatting** improves readability, but note styling is never the source of truth. Canonical structure lives in markdown + frontmatter generated by the CLI.
