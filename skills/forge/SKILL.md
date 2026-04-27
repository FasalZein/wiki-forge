---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the delivery workflow layer for tracked implementation work. It owns workflow state, slice ownership, Git boundaries, verification evidence, review evidence, handover continuity, and close readiness. Wiki remains the knowledge/freshness layer; Forge decides whether implementation may proceed or close.

Use this skill when changing runtime/product behavior, continuing a slice, creating follow-up work, handing over active work, or closing verified work. The CLI owns phase ordering and recovery; do not treat this skill body as workflow truth.

## Commands

- Context: `wiki resume <project> --repo <path> --base <rev>` and `wiki handover <project> --repo <path> --base <rev>`.
- Pick/inspect: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice] --repo <path> --json`.
- Freshness/repair: `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki maintain <project> --repo <path> --base <rev>`.
- Plan/run: `wiki forge plan <project> <feature-name> --repo <path>`, `wiki forge run <project> [slice-id] --repo <path>`.
- Evidence/review: `wiki forge evidence <project> <slice> <tdd|verify> ...`, `wiki forge review record <project> <slice> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name>`.
- Follow-up: `wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--repo <path>]`.

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`; it includes phase, skill, iteration contract, subagent policy, quality gates, and review gates.

Normal chain: `wiki research -> /domain-model` (+ `/torpathy` when design pressure is flagged) `-> /write-a-prd -> /prd-to-slices -> /tdd -> /desloppify`.

Dogfood non-trivial repo work with real Forge commands: `next`, explicit `status <slice>`, `checkpoint`, evidence/review records, then `wiki forge run <project> <slice> --repo <path>`. If stale active state disagrees with the latest handover target, trust `resume`/`status` steering and fix the lifecycle state rather than doing ad-hoc work.

`tdd` and `verify` are not skippable. Research, domain-model, PRD, and slices may be skipped only with an audited `wiki forge skip` reason.

When verify or closeout fails, do not assume a generic rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the repair path. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

If evidence or implementation context has drifted, use `wiki research bridge` before continuing delivery work. For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After editing repo skill files, run `bun run sync:local`, then `bun run sync:local -- --audit`, then restart the agent session.
