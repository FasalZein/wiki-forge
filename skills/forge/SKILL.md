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
research -> grill-me -> PRD -> slices -> TDD -> wiki verify -> improve-codebase-architecture (cadence) -> desloppify
```

The `improve-codebase-architecture` step runs at cadence boundaries (end of a PRD, batch of slices, or weekly minimum) — not after every slice. `desloppify` is the final line-level quality gate and is not optional for non-trivial work.

## Protocol Start Checklist

Run this **before** issuing any `wiki` CLI command when the skill loads:

1. **Audit the managed protocol block.** Read the block between `<!-- *:agent-protocol:start -->` and `<!-- *:agent-protocol:end -->` in the repo's `AGENTS.md` / `CLAUDE.md`. It must name the `/wiki`+`/forge` split and point at `wiki protocol sync`. If missing, malformed, or stale, run `wiki protocol audit <project> --repo <path>` and report the diff to the user before continuing. Never hand-edit the managed block; use `wiki protocol sync`.
2. **Reconcile skill vs. repo policy.** Scan the un-managed `# CLAUDE` / `# AGENTS` section for the completion flow and hard gates. If a rule contradicts this skill, **the repo instruction file wins** and you must surface the conflict explicitly instead of silently following one side.
3. **Sub-agent rule.** When delegating any wiki/forge lifecycle step (closeout, verification, research filing, drift), the sub-agent prompt must start with `Skill({ skill: "wiki" })` (or `/forge` for workflow work). Sub-agents do not inherit the parent's loaded skills.
4. **Resume, don't handover.** `wiki resume` at session start is read-only and safe to auto-run. `wiki handover` at session end is **user-invoked only** — see Hard Gates #10.

Skip only when the task is pure read-only retrieval.

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
- `/improve-codebase-architecture`
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
| 7 | `/improve-codebase-architecture` | Cadence-based structural review — surface deepening candidates, file an architecture review into the wiki, and turn accepted refactors into new features/PRDs/slices. Run after a surge of development (end of a PRD, batch of slices, weekly at minimum). Skip on small-scope runs. |
| 8 | `/desloppify` | Scan for AI slop, fix quality issues, verify score |

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
9. /improve-codebase-architecture — cadence check (run at the end of a PRD,
   a batch of slices, or at least weekly). Files an architecture review into
   the wiki; accepted deepening candidates become new features/PRDs/slices
   rather than silent rewrites. Skip for single-slice small-scope work.
10. /desloppify — scan, fix any new slop, verify score
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
10. **`wiki handover` is user-invoked, never automatic.** Run `wiki handover <project> --repo <path> --base <rev>` only when the user explicitly asks for a handover ("handover", "end session", "write handover for next agent"). It auto-captures activity, commits, state, and priorities, and writes a durable `.md` file to `projects/<project>/handovers/`. Use `--harness <name>` to tag and `--no-write` to skip file creation. Do NOT run it as a default end-of-task step, after a merge, or on your own judgment — the user decides when a session is done. `wiki resume <project> --repo <path> --base <rev>` is read-only and safe to auto-run at session start. Do not create ad hoc HANDOVER.md files.

## Definition of Done

A slice is complete only when all of these are true:

1. Tests exist and pass for the changed behavior.
2. `wiki gate <project> --repo <path> --base <rev>` passes (exit 0).
3. Impacted wiki pages are updated from code and tests.
4. `wiki lint <project>` and `wiki lint-semantic <project>` pass.
5. Changed pages are re-verified with `wiki verify-page` at `code-verified` or `test-verified`.
6. `wiki feature-status <project>` shows `computed_status=complete` (NOT `needs-verification`). This requires all child slices to be status=done AND verification_level=test-verified. `close-slice` auto-closes parent PRD/feature only when computed_status=complete; if it shows `needs-verification`, you must `verify-page` slice/PRD/feature pages to test-verified first, then `maintain` to refresh computed_status.
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
   f. `wiki verify-page <project> <page> code-verified` — for each impacted page
   g. `wiki verify-slice <project> <slice-id> --repo <path>` — runs test-plan commands; if FAIL, read the stderr/stdout output, fix, re-run
   h. `wiki verify-page <project> <slice-index> test-verified` — promote slice index
   i. `wiki verify-page <project> <prd-page> test-verified` — promote parent PRD
   j. `wiki verify-page <project> <feature-page> test-verified` — promote parent feature
   k. `wiki maintain <project> --repo <path> --base <rev>` — refreshes computed_status
   l. `wiki feature-status <project>` — confirm computed_status = complete (not needs-verification)
   m. `wiki closeout <project> --repo <path> --base <rev>` — only proceed if "PASS — ready to close"
   n. `wiki gate <project> --repo <path> --base <rev>`
   o. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>` — auto-triggers parent close if computed is complete
9. /improve-codebase-architecture — at cadence (end of PRD / batch of slices / ≥ weekly):
   a. Explore the codebase via the Explore subagent; surface deepening candidates.
   b. Pick a candidate, frame constraints, design 3+ interfaces in parallel.
   c. File the review into the wiki: `wiki research file <project> "architecture review <YYYY-MM-DD>"`.
   d. Accepted candidate → new `FEAT-<nnn>` + `PRD-<nnn>` via /forge, not a silent rewrite.
10. /desloppify — after wiki closeout and any architecture review:
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
7. /wiki closeout sequence (`checkpoint` -> `lint-repo` -> `maintain` -> page updates -> `verify-page code-verified` -> `verify-slice` -> `verify-page test-verified` on slice/PRD/feature -> `maintain` -> `feature-status` -> `closeout` -> `gate` -> `close-slice`)
8. /improve-codebase-architecture — run at PRD boundaries / batch boundaries / at least weekly. Skip if this continuation is a single small slice.
9. /desloppify — scan, fix, verify score
```

## Canonical Code-Driven Closeout Sequence

This is the canonical 13-step closeout sequence for an active slice. Every forge flow above (non-trivial, small-scope, continuation) collapses into this when it reaches the closeout phase. Run the steps in order — skipping any of them is how slices silently ship in `needs-verification` state.

1. `wiki checkpoint <project> --repo <path>` — freshness check
2. `wiki lint-repo <project> --repo <path>` — repo markdown violations
3. `wiki maintain <project> --repo <path> --base <rev>` — compose refresh + discovery
4. Update impacted wiki pages from code and tests
5. `wiki update-index <project> --write` — if navigation/planning links changed
6. `wiki verify-page <project> <page> code-verified` — for each impacted page
7. `wiki verify-slice <project> <slice-id> --repo <path>` — runs test-plan commands; if FAIL, read stderr/stdout output, fix, re-run
8. `wiki verify-page <project> <slice/prd/feature pages> test-verified` — promote hierarchy to test-verified
9. `wiki maintain <project> --repo <path> --base <rev>` — refresh computed_status after verification
10. `wiki feature-status <project>` — confirm computed_status = complete
11. `wiki closeout <project> --repo <path> --base <rev>` — only proceed if "PASS — ready to close" (not "REVIEW PASS")
12. `wiki gate <project> --repo <path> --base <rev>`
13. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>` — auto-triggers parent close if computed is complete

### Key concepts every agent must understand

**`closeout` is a review surface, not a completion gate.**
`closeout PASS` means "no hard blockers found" (currently: no missing tests). It does NOT mean "ready to close."
If stale pages or manual steps remain, closeout shows `REVIEW PASS — manual steps remaining`.
Only `PASS — ready to close` means the slice is fully closeable.
Always check the manual steps list in closeout output before proceeding to `close-slice`.

**`status` vs `computed_status` are different things.**
- `status` is a frontmatter field you (or `--force`) can set directly: `not-started`, `in-progress`, `complete`.
- `computed_status` is derived from child slices by `feature-status` and `maintain`: `not-started`, `in-progress`, `needs-verification`, `complete`.
- `computed_status = complete` requires ALL child slices to be status=done AND verification_level=test-verified.
- `--force` on close-slice/close-prd/close-feature changes `status` but does NOT change `computed_status`.
- `feature-status` shows `computed_status`, not `status`. So forcing everything closed still shows `needs-verification` if slice docs aren't test-verified.
- To resolve: `verify-page` all slice/PRD/feature pages to `test-verified`, then `maintain` to refresh `computed_status`.

**`verify-slice` runs test-plan commands and reports failures with details.**
If it returns FAIL, read the stderr/stdout output for each failed command. It will show exit codes and first 10 lines of error output. Fix the failing commands and re-run.

**The complete hierarchy closure sequence:**
1. `verify-slice` — run test-plan commands → promotes test-plan to test-verified
2. `verify-page` on slice index, PRD, and feature → promote to test-verified
3. `maintain` — refreshes `computed_status` from child verification levels
4. `feature-status` — confirm computed_status = complete
5. `close-slice` — moves to Done, auto-triggers parent close if computed is complete
6. If auto-close didn't fire: `close-prd` / `close-feature` (without `--force`)

For active slices, `wiki maintain` is the **first** closeout command, not the last. Follow it with page updates, `verify-page`, `verify-slice`, `closeout`, `gate`, and `close-slice`.

## Planning Scaffolds

SDLC scaffolds live on the `wiki` CLI but are driven from this workflow layer:

```bash
wiki create-feature <project> <name>          # creates specs/features/FEAT-<nnn>-<slug>.md
wiki create-prd <project> --feature <FEAT-ID> <name>
wiki create-issue-slice <project> <title> [--prd <PRD-ID>] [--assignee <agent>] [--source <path...>]   # creates specs/slices/<TASK-ID>/{index,plan,test-plan}.md + backlog task; --source overrides inherited parent PRD bindings
wiki create-plan <project> <name>             # creates specs/plan-<slug>.md and keeps it listed in specs/index.md
wiki create-test-plan <project> <name>        # creates specs/test-plan-<slug>.md and keeps it listed in specs/index.md
wiki backlog <project> [--assignee <agent>] [--json]
wiki add-task <project> <title> [--section Todo] [--prd <PRD-ID>] [--priority <p0-p2>] [--tag <tag>]
wiki move-task <project> <task-id> --to <section>
wiki complete-task <project> <task-id>               # shorthand for move-task --to Done
wiki start-slice <project> <slice-id> [--agent <name>] [--repo <path>] [--json]
wiki feature-status <project> [--json]               # computed hierarchy status table
wiki start-feature <project> <FEAT-ID>               # set status=in-progress; auto-triggered by start-slice
wiki close-feature <project> <FEAT-ID> [--force]     # set status=complete; auto-triggered by close-slice; gates on computed status
wiki start-prd <project> <PRD-ID>                    # set status=in-progress; auto-triggered by start-slice
wiki close-prd <project> <PRD-ID> [--force]          # set status=complete; auto-triggered by close-slice; gates on computed status
wiki claim <project> <slice-id> --agent <name>       # claim an existing slice for an agent
wiki next <project>                                  # recommend next slice respecting depends_on
wiki note <project> <slice-id> <text>                # durable agent-to-agent log
wiki export-prompt <project> <slice-id> [--agent codex|claude|pi]
```

Hierarchy rules:
- **feature** = project-level planning scope under `specs/features/`
- **PRD** = numbered requirement doc under `specs/prds/`, linked to one parent feature
- **slice docs** = task-scoped docs under `specs/slices/<TASK-ID>/`, optionally linked to one parent PRD
- standalone plan/test-plan docs live directly under `specs/` and appear in `specs/index.md` under Planning Docs
- `feature -> PRD -> slice` is metadata-driven (`feature_id`, `prd_id`, `parent_feature`, `parent_prd`)
- `create-issue-slice --prd <PRD-ID>` auto-binds the new slice docs to that PRD's `source_paths` when the parent PRD is already bound
- `create-issue-slice --assignee <agent>` writes assignee frontmatter into all generated slice docs
- `backlog --assignee <agent>` filters the queue and still surfaces blocked slices via `depends_on`
- `start-slice` is the lifecycle entry point: it enforces `depends_on`, detects claim conflicts, moves the backlog item to In Progress, records `started_at`, and prints a compact plan summary
- `start-slice` auto-opens parent PRD and feature if they are still `not-started`; `close-slice` auto-closes them when all children are complete
- `feature-status` shows the computed hierarchy: `not-started → in-progress → needs-verification → complete`; `maintain` auto-writes `computed_status` frontmatter and detects lifecycle drift

## SDLC Project Zones

Code-project folders owned by the forge workflow:

- `specs/features/` — planning scope parents.
- `specs/prds/` — numbered requirement docs.
- `specs/slices/` — execution slices.

Second-brain zones (`modules/`, `architecture/`, `code-map/`, `contracts/`, `data/`, `changes/`, `runbooks/`, `verification/`, `legacy/`) are documented in `/wiki`. Module and freeform-zone docs connect to planning via `source_paths` overlap; `wiki update-index <project> --write` refreshes derived sections across spec pages and freeform project zones.

## Greenfield Project

```text
1. wiki scaffold-project <project>
2. Set repo: in _summary.md frontmatter
3. Use /forge workflow: research → grill → PRD → slices → TDD
4. As code emerges, create modules:
   wiki create-module <project> <module-name> --source <paths...>
5. Before implementation begins, register the slice:
   wiki start-slice <project> <slice-id> --agent <name> --repo <path>
6. After each slice, run the canonical closeout sequence above.
```

## Source of Truth

- **Existing code** is the source of truth for implemented behavior.
- **PRDs + slices + test plans** are the source of intent for greenfield work.
- **The wiki** is compiled memory — maintained from code, never the other way around.
- **Research** is evidence backing decisions. `/research` gathers it; `wiki research ...` files it in the vault for traceability.
- **Obsidian formatting** improves readability, but note styling is never the source of truth. Canonical structure lives in markdown + frontmatter generated by the CLI.
