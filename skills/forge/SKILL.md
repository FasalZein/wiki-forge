---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the delivery workflow layer for tracked implementation work. It owns workflow state, slice ownership, Git boundaries, verification evidence, review evidence, and close readiness. Wiki remains the knowledge/freshness layer; Forge decides whether implementation may proceed or close.

Use this skill when changing runtime/product behavior, continuing a slice, creating follow-up work, or closing verified work. The CLI owns phase ordering and recovery; do not treat this skill body as the source of workflow truth.

## Current overhaul baseline

The P0 trust layer is in place:

- Git truth is explicit in checkpoint/status outputs; a dirty worktree cannot be reported as clean.
- Changed files are classified as active-slice, other-open-slice, closed-slice-amendment, ignored/generated, or unowned.
- Pipeline steps are invalidated by Git/content fingerprints instead of stale pass state.
- Closure readiness is attested across freshness, Git, ownership, verification, review, and ledger/workflow state.
- Review evidence is structured and blocks when `review_policy.required_approvals` requires it.
- Closed work is amended through a new slice via `wiki forge amend`, not by reopening old close evidence.

P1/P2 work is still open: richer verification specs, behavior evidence mapping, typed/scoped checks, lower false positives, and a first-class dogfood harness.

## Commands

- Start or resume context: `wiki resume <project> --repo <path> --base <rev>`
- Pick work: `wiki forge next <project> --repo <path>`
- Inspect workflow truth: `wiki forge status <project> [slice] --repo <path>`
- Inspect workflow truth in machine-readable form: `wiki forge status <project> [slice] --repo <path> --json`
- Refresh freshness/Git truth: `wiki checkpoint <project> --repo <path> --base <rev>`
- Repair stale state, closeout debt, or verify-loop conditions: `wiki maintain <project> --repo <path> --base <rev>`
- Reconnect research when implementation needs fresh evidence: `wiki research bridge`
- Plan work: `wiki forge plan <project> <feature-name> --repo <path>`
- Record TDD/verification evidence: `wiki forge evidence <project> <slice> <tdd|verify> ...`
- Record review evidence: `wiki forge review record <project> <slice> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name> [--repo <path>]`
- Run check+close chain: `wiki forge run <project> [slice-id] --repo <path>`
- Create a follow-up for closed work without reopening it: `wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--repo <path>]`
- Waive a skippable phase: `wiki forge skip <project> <slice> <phase> --reason <text>`

If the installed `wiki` binary is unavailable while dogfooding this repository, use `bun src/index.ts ...` from the repo root as the equivalent CLI entrypoint.

## Dogfood contract

For non-trivial repo changes, do not rely on tests alone as proof that Forge works.

1. Run `wiki forge next <project> --repo <path>` before choosing work. If the active slice is stale or unrelated, create/repair the tracked slice instead of silently doing ad-hoc work.
2. Run `wiki forge status <project> [slice] --repo <path> --json` before implementation and before closeout; treat it as workflow truth.
3. Run `wiki checkpoint <project> --repo <path> --base <rev> --json` when Git or freshness truth matters.
4. Record evidence in the slice (`wiki forge evidence ...`) and, when policy requires it, record review (`wiki forge review record ...`).
5. Close through `wiki forge run ...` or explain explicitly why the dogfood close cannot be used yet. If it cannot be used, record the gap as follow-up work.

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`. It includes the current phase, required skill, iteration contract, subagent policy, quality gates, and review gates.

Normal chain: `wiki research -> /domain-model` (+ `/torpathy` when design pressure is flagged) `-> /write-a-prd -> /prd-to-slices -> /tdd -> /desloppify`.

After planning, obey the runtime subagent policy: evaluate subagent-driven vs linear implementation before TDD edits, choose linear when subagents would create conflicts, and use the required reviewer subagents before closeout.

`tdd` and `verify` are not skippable. Research, domain-model, PRD, and slices may be skipped only with an audited `wiki forge skip` reason.

When verify or closeout fails, do not assume a generic forge rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the explicit repair path for stale-page closeout noise, checkpoint debt, or repeated verify loops. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

If evidence or implementation context has drifted, use `wiki research bridge` before continuing delivery work.

For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After applying repo skill file changes, run:

```bash
bun run sync:local
bun run sync:local -- --audit
```

Then restart the agent session.
