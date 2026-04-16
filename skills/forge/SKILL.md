---
name: forge
description: >
  Build with rigor. Orchestrates research -> grill -> PRD -> slices -> TDD before anything ships.
  Forge is the workflow layer, not the research layer or wiki layer. It loads companion skills and checks gates. Zero API calls — everything stays in the wiki vault.
---

# Forge

Forge is the workflow layer. It coordinates separate companion layers:
- research = actual evidence gathering and option comparison
- wiki = maintained knowledge and verification
- forge = delivery policy tying them together

Every non-trivial change follows this order. No exceptions.

```text
research -> grill-me -> PRD -> slices -> TDD -> wiki verify
```

## Invocation Model

Assume a harness can use both `/wiki` and `/forge`.
The real decision is **which workflow fits the task**.

- `/wiki` = memory, research filing/audit, retrieval, verification, drift, closeout
- `/forge` = full software-delivery workflow for non-trivial implementation

If a harness uses different syntax for skills, keep the same boundary and sequence.
If a harness has no slash-skill syntax, run the equivalent `wiki` CLI lifecycle directly.

## Required Skills

Forge assumes these companion skills are available in the repo `skills/` directory:
- `/research`
- `/grill-me`
- `/write-a-prd`
- `/prd-to-slices`
- `/tdd`
- `/wiki`
- `/desloppify`

If any required skill is unavailable, stop and tell the user which one is missing. Do not silently skip steps.

Load these in order before writing production code:

| Step | Invoke | Purpose |
|------|--------|---------|
| 1 | `/research` | Gather evidence, compare options, validate assumptions |
| 2 | `/grill-me` | Stress-test the plan — resolve ambiguities before committing |
| 3 | `/write-a-prd` | Capture problem, scope, modules, acceptance criteria |
| 4 | `/prd-to-slices` | Break PRD into tracer-bullet vertical slices in the wiki backlog |
| 5 | `/tdd` | Red-green-refactor for each slice |
| 6 | `/wiki` | File artifacts, verify pages, run gate |
| 7 | `/desloppify` | Scan for AI slop, fix quality issues, verify score |

If a skill is unavailable, stop and tell the user. Do not silently skip steps.
This skill defines required workflow policy. The CLI does not yet hard-enforce every step, so agents must still run the full lifecycle explicitly.

**Note:** `/prd-to-issues` (GitHub variant) exists for projects needing external issue tracking. For solo or agent-driven work, `/prd-to-slices` is faster and token-free.

## Execution Modes

### Non-trivial (full pipeline)

Trigger `/forge` for:
- A new feature or workflow
- Behavior that crosses module boundaries
- Changes that need research or design tradeoffs
- Performance or refactor work spanning multiple commands/modules
- Work likely to become a tracked slice/backlog item
- Anything that should leave PRD + slice history in the wiki
- Continuing an existing PRD / feature / slice, even if the next step sounds like "just proceed"
- Creating, selecting, or advancing a backlog slice

Full sequence:
```text
1. /research — gather evidence and decide; then file: wiki research file <project> <title>
2. /grill-me — defend the approach, resolve unknowns
3. /write-a-prd — capture scope, link to research in Prior Research section
4. /prd-to-slices — break into vertical slices (wiki create-issue-slice per slice)
5. Select the next slice using wiki next <project> to respect depends_on ordering
6. Fill the selected slice docs before coding:
   a. wiki start-slice <project> <slice-id> --agent <name> --repo <path>
   b. fill plan.md
   c. fill test-plan.md
7. /tdd — for each slice: red-green-refactor
8. /wiki — after each slice: full closeout sequence
9. /desloppify — scan, fix any new slop, verify score
```

### Small scope (< 50 lines)

Skip research/grill/PRD/slices but still need tests and verification. **TDD is still mandatory.**

```text
1. /tdd — write a failing test that reproduces the bug, fix the code
2. /wiki — closeout:
   wiki checkpoint <project> --repo <path>
   wiki lint-repo <project> --repo <path>
   wiki maintain <project> --repo <path> --base <rev>
   update impacted wiki pages from code
   wiki update-index <project> --write (if navigation changed)
   wiki verify-page <project> <page> code-verified
   wiki closeout <project> --repo <path> --base <rev>
   wiki gate <project> --repo <path> --base <rev>
3. /desloppify — scan, fix new slop, verify no regression
```

### Docs/wiki only

No code changes — just knowledge layer work:

```text
/wiki + /obsidian-markdown
```

### Exploration only

Understanding code or onboarding:

```text
/wiki (search, ask, discover, onboard)
```

## Decision Rule

Ask: "Does this need the full pipeline, or is it already part of existing work?"

| Situation | Workflow |
|-----------|----------|
| New feature or workflow | `/forge` (full) |
| Cross-module behavior change | `/forge` (full) |
| Continuing existing PRD/slice | `/forge` (delta) |
| Research as part of implementation | `/forge` (research as phase 1) |
| Bug fix < 50 lines | `/tdd` + `/wiki` |
| Docs/wiki/formatting only | `/wiki` + `/obsidian-markdown` |
| Repo exploration or understanding | `/wiki` only |
| Research-only / filing / audit | `/wiki` only |

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

1. **No code without tests. No exceptions. Ever.** Every code change MUST have corresponding tests. This is non-negotiable — no "it's too simple to test", no "I'll add tests later", no "this is just a refactor". If you changed code, you changed or added tests. Period.
2. **Run `wiki gate` before declaring done.** Today it hard-blocks missing tests; agents must still clear stale-page and workflow warnings before closing a slice.
3. **PRD + slicing before non-trivial implementation.**
4. **Research before PRD.** Run `/research` first, then file the result with `wiki research file` so decisions are traceable.
5. **Grill before PRD.** Stress-test assumptions — don't commit to a spec you haven't defended.
6. **Read code before updating wiki.** Never write docs from memory alone.
7. **No unmaintainable code.** If a slice passes tests but worsens maintainability, refactor before closing.
8. **Never create `.md` documentation inside project repos** except `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, and `skills/*/SKILL.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.
9. **Use protocol sync for repo agent instructions.** Install/update repo `AGENTS.md` / `CLAUDE.md` via `wiki protocol sync <project> --repo <path>` instead of hand-editing the managed protocol block.
10. **Use `wiki handover` for session transitions.** Run `wiki handover <project> --repo <path> --base <rev>` at session end — it auto-captures activity, commits, state, and priorities, and writes a durable `.md` file to `projects/<project>/handovers/`. Use `--harness <name>` to tag the handover and `--no-write` to skip file creation. Run `wiki resume <project> --repo <path> --base <rev>` at session start (it reads the latest handover file). Do not create ad hoc HANDOVER.md files.

## Definition of Done

A slice is complete only when all of these are true:

1. Tests exist and pass for the changed behavior.
2. `wiki gate <project> --repo <path> --base <rev>` passes (exit 0).
3. Impacted wiki pages are updated from code and tests.
4. `wiki lint <project>` and `wiki lint-semantic <project>` pass.
5. Changed pages are re-verified with `wiki verify-page` at `code-verified` or `test-verified`.
6. `wiki feature-status <project>` shows no unexpected drift. `close-slice` auto-closes parent PRD/feature when all children are complete; `start-slice` auto-opens them when still not-started.
7. `desloppify score .` shows no regression. Run `desloppify scan .` and fix any new issues before closing.

## Workflow: Build or Change a Feature

```text
1. /research — gather evidence and decide; then file it with: wiki research file <project> <title>
2. /grill-me — defend the approach, resolve unknowns
3. /write-a-prd — capture scope, link to research in Prior Research section
4. /prd-to-slices — break into vertical slices (wiki create-issue-slice per slice)
5. Select the next slice using `wiki next <project>` to respect `depends_on` ordering
6. Fill the selected slice docs before coding:
   a. run `wiki start-slice <project> <slice-id> --agent <name> --repo <path>`
   b. fill plan.md
   c. fill test-plan.md
7. /tdd — for each slice:
   a. Write failing tests first
   b. Make them pass with minimal code
   c. Refactor
   d. Run tests
8. /wiki — after each slice:
   a. `wiki checkpoint <project> --repo <path>`
   b. `wiki lint-repo <project> --repo <path>`
   c. `wiki maintain <project> --repo <path> --base <rev>`
   d. Update impacted wiki pages from code
   e. `wiki update-index <project> --write` (if navigation/planning links changed)
   f. `wiki verify-page <project> <page> code-verified`
   g. `wiki verify-slice <project> <slice-id> --repo <path>`
   h. `wiki closeout <project> --repo <path> --base <rev>` to review the composed status
   i. `wiki gate <project> --repo <path> --base <rev>`
   j. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>`
9. /desloppify — after wiki closeout:
   a. `desloppify scan . --json` to detect new slop
   b. Fix issues by category (AI slop, complexity, naming, etc.)
   c. `desloppify score .` to verify no regression
```

## Workflow: Continue an Existing PRD / Slice Thread

```text
1. Stay in /forge mode
2. File any new evidence with /research + wiki research file
3. Re-check unresolved decisions with /grill-me when needed
4. Select or create the next slice under the existing PRD
5. Run `wiki start-slice <project> <slice-id> --agent <name> --repo <path>` and fill plan.md + test-plan.md
6. /tdd for the slice
7. /wiki closeout sequence (`checkpoint` -> `lint-repo` -> `maintain` -> page updates -> `verify-page` -> `verify-slice` -> `closeout` -> `gate` -> `close-slice`)
8. /desloppify — scan, fix, verify score
```

## Source of Truth

- **Existing code** is the source of truth for implemented behavior.
- **PRDs + slices + test plans** are the source of intent for greenfield work.
- **The wiki** is compiled memory — maintained from code, never the other way around.
- **Research** is evidence backing decisions. `/research` gathers it; `wiki research ...` files it in the vault for traceability.
- **Obsidian formatting** improves readability, but note styling is never the source of truth. Canonical structure lives in markdown + frontmatter generated by the CLI.
