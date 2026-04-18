---
name: forge
description: >
  Build with rigor. Orchestrates research -> grill -> PRD -> slices -> TDD before anything ships.
  Forge is the workflow layer, not the research layer or wiki layer. It loads companion skills and checks gates. Zero API calls — everything stays in the wiki vault.
---

# Forge

Forge is the workflow layer.

- `wiki` = knowledge, verification, drift, retrieval, filing
- `forge` = delivery policy over those primitives
- default agent surface = `wiki forge start|open|check|close|run|plan|status`
- default reconciliation primitive = `wiki sync`

The contract stays:

```text
research -> grill-me -> PRD -> slices -> TDD -> wiki verify -> improve-codebase-architecture (cadence) -> desloppify
```

## Protocol Start Checklist

Run this before any write-oriented `wiki` command unless the task is pure read-only retrieval.

1. Read the managed protocol block in repo `AGENTS.md` / `CLAUDE.md`.
2. If it looks stale or malformed, run `wiki protocol audit <project> --repo <path>` and surface the diff.
3. Reconcile repo-local instructions vs this skill. If they conflict, the repo instruction file wins.
4. Run `wiki resume <project> --repo <path> --base <rev>` at session start.
5. When delegating wiki/forge work to a sub-agent, explicitly load `/wiki` or `/forge` in that prompt.

## When To Use Forge

Use `/forge` for:
- any feature / PRD / slice work
- continuing an existing implementation thread
- cross-module behavior changes or refactors
- workflow, lifecycle, or operator-surface changes
- work that should leave PRD + slice history in the wiki

Do **not** silently downgrade an active slice thread into plain `/wiki` maintenance.

## Required Skills

Forge assumes these repo skills exist:
- `/research`
- `/grill-me`
- `/write-a-prd`
- `/prd-to-slices`
- `/tdd`
- `/wiki`
- `/improve-codebase-architecture`
- `/desloppify`

If one is unavailable, stop and name it.

## Default Happy Path

Prefer the thin surface first.

```text
1. /research
2. /grill-me
3. wiki forge plan <project> <feature-name> [--agent <name> --repo <path>]
   — or manually: /write-a-prd -> /prd-to-slices -> wiki forge start
4. fill plan.md + test-plan.md
5. /tdd
6. wiki forge run <project> [slice-id] --repo <path>
   — or manually: wiki forge check -> fix -> wiki forge close
7. wiki forge status <project> [slice-id]
```

Meaning of the grouped commands:
- `wiki forge plan` = create-feature + create-prd + create-issue-slice + start-slice in one step
- `wiki forge start/open` = choose/open a single slice and register the lifecycle entry point
- `wiki forge check` = run the slice-local verification/closeout review path
- `wiki forge close` = finish the close sequence when check is clean
- `wiki forge run` = check + close in a single pass (stops if check fails)
- `wiki forge status` = show the current forge workflow ledger / phase state

## Low-Level Escape Hatches

Use lower-level verbs only for repair, debugging, or very explicit control:
- `wiki sync`
- `wiki start-slice`
- `wiki verify-slice`
- `wiki closeout`
- `wiki gate`
- `wiki close-slice`
- `wiki feature-status`

They still exist, but they are not the primary operator surface anymore.

## Closeout Rule

Treat `wiki forge check` as the default closeout review surface.

If you must drop lower:
1. `wiki maintain`
2. update impacted pages from code/tests
3. `wiki verify-page`
4. `wiki verify-slice`
5. `wiki closeout`
6. `wiki gate`
7. `wiki close-slice`

Remember:
- `closeout` is review, not completion by itself
- `gate` must pass before declaring done
- stronger verification levels are preserved unless explicitly downgraded
- parent `computed_status` is derived, not manually authored truth

## Hard Gates

1. No code change without tests.
2. No non-trivial implementation without PRD + slice tracking.
3. Research comes before PRD; grill comes before committing the design.
4. Update wiki pages from code/tests, not memory.
5. Do not create extra repo markdown outside the allowed set.
6. `wiki handover` is user-invoked only.

## Local Refresh Rule

When you edit any of these locally:
- `skills/*/SKILL.md`
- README / setup text that teaches the operator surface
- `scripts/sync-local.ts`

run:

```bash
bun run sync:local
bun run sync:local -- --audit
```

`sync:local` is the local install step for the CLI, qmd, and repo-owned skills. `--audit` checks whether the installed repo-owned skill copies have drifted from the repo. Restart the agent session after syncing so the refreshed skills are loaded.

## Planning Notes

- Keep slice docs as the authored lifecycle source.
- Let backlog, parent rollups, protocol surfaces, and derived indexes be computed by code.
- Prefer direct markdown editing plus reconciliation over long command choreography.
- Use `wiki help` for the raw CLI inventory; do not restate the full catalog in prompts unless a repair path truly needs it.

## Source Of Truth

- code = implemented behavior
- PRD / slice / test-plan = current delivery intent
- wiki = compiled memory maintained from sources
- research = evidence behind decisions
