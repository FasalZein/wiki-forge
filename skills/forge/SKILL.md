---
name: forge
description: >
  Build with rigor. Orchestrates research -> domain-model -> PRD -> slices -> TDD before anything ships.
  Forge is the workflow layer, not the research layer or wiki layer. It loads repo-owned workflow skills and checks gates. Zero API calls — everything stays in the wiki vault.
---

# Forge

Forge is the workflow layer.

- `wiki` = knowledge, verification, drift, retrieval, filing
- `forge` = delivery policy over those primitives
- agent surface (3 commands) = `wiki forge plan`, `wiki forge run`, `wiki forge next`
- internal/repair = `wiki forge start|check|close|status|release`
- default reconciliation primitive = `wiki sync`
- default `wiki help` is workflow-first; use `wiki help --all` for the exhaustive CLI catalog
- one project should use one authoritative wiki/vault; parallel agents should share that vault and claim different slices

## Router

Decide the state first. Then run the command for that state.

- memory-only or verification-only work: use `/wiki`
- active slice, pre-implementation gate: follow `wiki forge status <project> <slice>` and load the named skill
- active slice, implementation-ready: run `wiki forge run <project> <slice> --repo <path>`
- stale, conflicting, failed, verify-loop, or closeout-blocked state: use the repair branch that matches the blocker; return to `wiki forge run` only after the blocker is cleared

Do not start with low-level verbs. Start by classifying the state.

## Command Authority

When outputs disagree, do not average them together. Use this precedence:

1. `wiki checkpoint` = current freshness truth
2. `wiki maintain` = repair/reconciliation plan
3. `wiki forge status` = workflow ledger truth
4. `wiki resume` = operator context summary only; it may include historical notes/noise

Interpretation rule:

- If `checkpoint` is clean, freshness is clean even if `resume` still prints historical context.
- If `forge status` says a phase is incomplete, treat that as the workflow truth even if an older failed run breadcrumb suggests otherwise.
- If `maintain` and `checkpoint` disagree, prefer `checkpoint` for current stale/not-stale truth and use `maintain` for repair actions.
- If verify/close emits stale-page or checkpoint debt noise, treat that as a freshness/maintenance problem first, not as evidence that the workflow phase should be rerun.

## State Table

| State | Command | Expected output | Next move |
|---|---|---|---|
| session start | `wiki resume <project> --repo <path> --base <rev>` | steering packet + recovery hints | obey the next command unless you are debugging |
| no active/ready slice | `wiki forge next <project>` | one recommended slice or `no ready slices` | if none, plan the next feature/PRD/slices |
| research missing | `wiki forge status <project> <slice> --json` | `nextPhase: research` | `/research`, then `wiki research distill`, then `wiki research adopt` |
| domain-model missing | `wiki forge status <project> <slice> --json` | `nextPhase: domain-model` | `/domain-model`, update `projects/<project>/decisions.md` and `projects/<project>/architecture/domain-language.md` |
| implementation-ready | `wiki forge run <project> <slice> --repo <path>` | pipeline execution across check/verify/close | continue on `forge run` while the blocker is inside the active phase |
| failed verify step | exact rerun/recovery command from `wiki resume` or `wiki forge status` | verify or checkpoint repair command | rerun that exact command before falling back to a broader workflow rerun |
| failed breadcrumb | `wiki forge status <project> <slice> --json` | current phase vs failed step | obey current phase if earlier than the failed step; otherwise rerun `forge run` |
| freshness contradiction | `wiki checkpoint` then `wiki maintain` | current stale truth + repair plan | execute the indicated maintenance command, then resume workflow |
| stale-page closeout noise | `wiki checkpoint` then `wiki maintain` | stale truth + page-level repair path | repair freshness debt explicitly; do not use generic reruns as the first response |
| close-path checkpoint debt | `wiki checkpoint` then close-path commands | close blocked by freshness mismatch | clear checkpoint debt with the maintenance path before retrying close |

## Default Surface

Agents should use only this default surface unless debugging:

- `wiki resume <project> --repo <path> --base <rev>`
- `wiki forge next <project>`
- `wiki forge plan <project> ...`
- `wiki forge run <project> [slice-id] --repo <path>`

Do not improvise lower-level lifecycle commands during normal execution.

## Handover Contract

When ending a tracked session, the durable handover is not supposed to be auto-only summary text.

- use `wiki handover <project> ... --accomplished "<what changed>" --blocker "<what remains>"` when a blocker exists
- use `wiki handover <project> ... --accomplished "<what changed>" --no-blockers` when there is no blocker
- `--allow-auto-only` is an explicit bypass, not the default path
- the goal is for the next session to pick up authored delta plus tracked artifacts, not to reconstruct context from scratch

## Repair Branches

Use these only when the default surface is blocked or contradictory.

### Workflow Truth

1. `wiki forge status <project> <slice> --json`
2. read `workflow.validation.nextPhase`
3. if the slice is done, return to `wiki forge next <project>`

When debugging, prefer the slice-scoped form. It is the safer surface because it removes ambiguity about which slice is being evaluated.

### Freshness Truth

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
2. `wiki maintain <project> --repo <path> --base <rev>`
3. optionally scope the reconciler with `wiki sync <project> [--repo <path>] [--report-only]`
4. choose one repair path from the maintain/checkpoint result:
   - accepted impact: `wiki acknowledge-impact <project> <page...> --repo <path>`
   - git reconciliation: `wiki refresh-from-git <project> --repo <path> --base <rev>`
   - broad bindings: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`
   - real page drift: update the page, then `wiki verify-page <project> <page> <level>`
5. re-run the blocked verifier/close command only after the freshness issue is cleared
6. return to `wiki forge run` only if workflow status still points at active implementation work

If `wiki resume` or `wiki forge status` already names a concrete recovery command such as `rerun verify-slice` or a slice-scoped `wiki checkpoint ... --slice-local --slice-id <slice>`, prefer that exact command over a generic rerun.

### Research Bridge

Distilling research is not enough for forge truth by itself.

1. `wiki research file <topic> --project <project> <title>`
2. `wiki research distill <research-page> <projects/<project>/decisions|projects/<project>/architecture/domain-language>`
3. `wiki research adopt <research-page> --project <project> --slice <slice-id>`
4. `wiki forge status <project> <slice>`

If research already exists, do not guess at frontmatter or caches. Adopt it explicitly.

### Close-Path Divergence

1. `wiki verify-slice <project> <slice>`
2. if verify already failed and the tooling names a concrete rerun command, use that exact rerun first
3. if closeout/gate/close-slice reports stale pages, checkpoint mismatch, or historical checkpoint debt, run `wiki checkpoint <project> --repo <path> --base <rev> --slice-local --slice-id <slice>`
4. then run `wiki maintain <project> --repo <path> --base <rev>`
5. when debugging worktree-local or historical closeout noise, prefer `wiki closeout <project> --repo <path> --worktree --slice-local --slice-id <slice>` and the matching `wiki gate ... --worktree --slice-local --slice-id <slice>`
6. apply the named maintenance action before retrying close-path commands
7. if close-slice returns a review-pass hint, either finish the named closeout steps or rerun `wiki close-slice <project> <slice> --repo <path> --base <rev> --force-review`
8. `wiki closeout <project> --repo <path> --base <rev>`
9. `wiki gate <project> --repo <path> --base <rev>`
10. `wiki close-slice <project> <slice> --repo <path> --base <rev>`

Treat active slice blockers as current work. Treat project debt and historical warnings as background unless they block the slice. If the blocker is stale-page closeout noise, route to freshness maintenance first, not to a blind workflow rerun.

### Claim / Recovery

1. `wiki forge status <project> <slice> --json`
2. if the slice should continue and no freshness blocker remains, rerun `wiki forge run <project> <slice> --repo <path>`
3. if the claim is wrong/stale, use `wiki forge release <project> <slice>`
4. if the slice is being explicitly cancelled, use `wiki close-slice <project> <slice> --reason \"<reason>\"`

## Workflow Contract

The contract stays:

```text
research -> domain-model -> PRD -> slices -> TDD -> wiki verify -> improve-codebase-architecture (cadence) -> desloppify
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

Do not silently downgrade an active slice thread into plain `/wiki` maintenance.

## Required Skills

Forge assumes these repo skills exist:

- `/research`
- `/domain-model`
- `/write-a-prd`
- `/prd-to-slices`
- `/tdd`
- `/wiki`
- `/improve-codebase-architecture`
- `/desloppify`

If one is unavailable, stop and name it.

## Install Parity

After applying skill changes that affect CLI or skill behavior, validate both:

- repo-local/dev path: the checked-out repo commands and tests
- installed/synced path: the globally installed `wiki` binary + installed repo-owned skill copies

Minimum parity check after skill edits:

```bash
bun run sync:local
bun run sync:local -- --audit
```

Then restart the agent session so installed skill copies, not just repo files, are in effect.

## Hard Gates

1. No code change without tests.
2. No non-trivial implementation without PRD + slice tracking.
3. Research comes before PRD; domain modeling comes before committing the design.
4. Update wiki pages from code/tests, not memory.
5. Do not create extra repo markdown outside the allowed set.
