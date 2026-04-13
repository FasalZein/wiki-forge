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

## Invocation Model

Assume a harness can use both `/wiki` and `/forge`.
The real decision is **which workflow fits the task**.

- `/wiki` = memory, research filing/audit, retrieval, verification, drift, closeout
- `/forge` = full software-delivery workflow for non-trivial implementation

If a harness uses different syntax for skills, keep the same boundary and sequence.

## Companion Skills

Install these before relying on `/forge`:

```bash
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
npx skills@latest add ./skills/prd-to-slices -g
npx skills@latest add ./skills/wiki -g
```

`/research` is also required. If it is not already available, stop instead of silently skipping the first forge step.

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

## Use Forge vs Wiki

Use `/forge` when the task is non-trivial implementation workflow.
Use `/wiki` when the task stays in the knowledge/verification layer.

Choose `/forge` for:
- new features or workflows
- cross-module behavior changes
- performance or refactor work with design tradeoffs
- any task that should leave PRD + slice history
- continuing an existing PRD/slice thread
- selecting, claiming, implementing, verifying, or closing a slice as part of shipping code
- research that is the first phase of a larger implementation effort

Choose `/wiki` for:
- research-only work or research filing/audit
- retrieval and project Q&A
- refresh/verify/gate work after implementation choices are already made
- wiki maintenance, drift cleanup, binding, navigation, and vault hygiene
- docs/wiki formatting work
- repo exploration or onboarding

Rule of thumb:
- changing runtime/product behavior -> `/forge`
- researching, retrieving, documenting, or verifying without active product changes -> `/wiki`

## What Counts as Non-Trivial

Use forge when the task needs the forge pipeline **or is continuing work that already came from that pipeline**.

Trigger `/forge` for work like:
- a new feature or workflow
- behavior that crosses module boundaries
- changes that need research or design tradeoffs
- performance or refactor work spanning multiple commands/modules
- work likely to become a tracked slice/backlog item
- anything that should leave PRD + slice history in the wiki
- continuing an existing PRD / feature / slice, even if the next step sounds like "just proceed"
- creating, selecting, or advancing a backlog slice

Do **not** trigger `/forge` for:
- bug fixes under ~50 lines of diff
- small focused refactors that do not need slice tracking
- config or dependency changes
- docs-only changes
- wiki formatting / note cleanup
- repo exploration or code reading

For smaller tasks, use the smallest fitting workflow instead:
- code fix: `/tdd` + `/wiki`
- wiki/note work: `/wiki` + `/obsidian-markdown`
- exploration: `/wiki`

When in doubt, ask: "does this need research → PRD → slices, or is it already part of existing PRD/slice work?" If yes, use forge.

## Continuation Rule

If the previous work was a non-trivial slice, PRD, or feature thread, stay in forge mode by default.

Treat prompts like these as **continue-forge**, not as generic maintenance:
- "proceed"
- "continue"
- "do the next slice"
- "pick up the next perf task"
- "finish the follow-up"

Continuation still requires the forge structure. Usually this is a **delta forge cycle**:
1. `/research` for the new evidence or decision delta
2. `/grill-me` for unresolved design choices
3. confirm the existing PRD still covers scope, or update/create the PRD
4. `/prd-to-slices` to create/select the next slice
5. `/tdd` for implementation
6. `/wiki` for closeout

Do not silently downgrade a slice continuation into `/wiki` maintenance mode just because the PRD already exists.

## Hard Gates

1. **No code without tests.** Every code change needs changed tests, or a documented exception in the wiki.
2. **Run `wiki gate` before declaring done.** It blocks on missing tests.
3. **PRD + slicing before non-trivial implementation.**
4. **Research before PRD.** Run `/research` first, then file the result with `wiki research file` so decisions are traceable.
5. **Grill before PRD.** Stress-test assumptions — don't commit to a spec you haven't defended.
6. **Read code before updating wiki.** Never write docs from memory alone.
7. **No unmaintainable code.** If a slice passes tests but worsens maintainability, refactor before closing.
8. **Never create `.md` documentation inside project repos** except `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, and `skills/*/SKILL.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.
9. **Use protocol sync for repo agent instructions.** Install/update repo `AGENTS.md` / `CLAUDE.md` via `wiki protocol sync <project> --repo <path>` instead of hand-editing the managed protocol block.
10. **Use the wiki vault or session artifacts for planning/handoffs.** Do not create ad hoc repo markdown handoff files.

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
5. Fill the selected slice docs before coding:
   a. run `wiki start-slice <project> <slice-id> --agent <name> --repo <path>`
   b. fill plan.md
   c. fill test-plan.md
6. /tdd — for each slice:
   a. Write failing tests first
   b. Make them pass with minimal code
   c. Refactor
   d. Run tests
7. /wiki — after each slice:
   a. `wiki checkpoint <project> --repo <path>`
   b. `wiki lint-repo <project> --repo <path>`
   c. Update impacted wiki pages from code
   d. `wiki verify-page <project> <page> code-verified`
   e. `wiki closeout <project> --repo <path> --base <rev>`
   f. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>`
```

## Workflow: Continue an Existing PRD / Slice Thread

```text
1. Stay in /forge mode
2. File any new evidence with /research + wiki research file
3. Re-check unresolved decisions with /grill-me when needed
4. Select or create the next slice under the existing PRD
5. Run `wiki start-slice <project> <slice-id> --agent <name> --repo <path>` and fill plan.md + test-plan.md
6. /tdd for the slice
7. /wiki closeout sequence (`checkpoint` -> `lint-repo` -> page updates -> `verify-page` -> `closeout` -> `close-slice`)
```

## Workflow: Small Task / Bug Fix (< 50 lines)

```text
1. /tdd — write a failing test that reproduces the bug
2. Fix the code, make the test pass
3. /wiki — closeout:
   a. Update impacted wiki pages from code
   b. wiki verify-page <project> <page> code-verified
   c. wiki closeout <project> --repo <path> --base <rev>
```

## Source of Truth

- **Existing code** is the source of truth for implemented behavior.
- **PRDs + slices + test plans** are the source of intent for greenfield work.
- **The wiki** is compiled memory — maintained from code, never the other way around.
- **Research** is evidence backing decisions. `/research` gathers it; `wiki research ...` files it in the vault for traceability.
- **Obsidian formatting** improves readability, but note styling is never the source of truth. Canonical structure lives in markdown + frontmatter generated by the CLI.
