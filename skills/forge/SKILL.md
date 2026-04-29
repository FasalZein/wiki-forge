---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the SDLC lifecycle layer for tracked implementation work. It owns workflow state, slice ownership, Git boundaries, verification evidence, review evidence, handover continuity, and close readiness. Wiki remains the second-brain memory layer; Forge decides whether implementation may proceed or close.

Use this skill when changing runtime/product behavior, continuing a slice, creating follow-up work, handing over active work, or closing verified work. The CLI and V1 kernel own phase ordering, invariants, and close gates. Do not treat this skill body as workflow truth.

## Commands

- Context: `wiki resume <project> --repo <path> --base <rev>` and `wiki handover <project> --repo <path> --base <rev>`.
- Pick/inspect: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice] --repo <path> --json`.
- Freshness/repair: `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki maintain <project> --repo <path> --base <rev>`.
- Plan/run: `wiki forge plan <project> <feature-name> --repo <path>`, `wiki forge run <project> [slice-id] --repo <path>`.
- Evidence/review: `wiki forge evidence <project> <slice> <tdd|verify> ...`, `wiki forge review record <project> <slice> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name>`.
- Follow-up: `wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--repo <path>]`.

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`; it includes phase, skill, iteration contract, subagent policy, quality gates, and review gates.

Normal chain: `research -> domain-model -> spec -> slices -> ownership -> implementation -> tdd -> verification -> review -> close`, using `wiki research`, `/domain-model`, `wiki forge plan`, `wiki forge start/run/status`, `/tdd`, targeted verification evidence, review evidence, and close gates. `/write-a-prd` and `/prd-to-slices` may help shape the content, but `wiki forge plan` is the command that creates or resumes Forge-owned planning artifacts.

Use subagents only after the plan identifies non-overlapping files or artifacts. If ownership is shared or context handoff would be risky, run the work sequentially.

Dogfood non-trivial repo work with real Forge commands: `next`, explicit `status <slice>`, `checkpoint`, evidence/review records, then `wiki forge run <project> <slice> --repo <path>`. If stale active state disagrees with the latest handover target, trust `resume`/`status` steering and fix the lifecycle state rather than doing ad-hoc work.

`tdd`, targeted verification, required review, and close are not skippable. Research, domain-model, PRD/spec, and slices can be skipped only when the Forge status/rejection packet accepts an explicit audited reason; do not invent a manual bypass.

When verification, review, check, or close fails, do not assume a generic rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the repair path. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

Removed legacy commands are not part of the workflow surface: do not use `wiki create-issue-slice`, `wiki start-slice`, `wiki verify-slice`, `wiki close-slice`, `wiki claim`, `wiki pipeline`, `wiki backlog`, `wiki gate`, or `wiki closeout` for tracked implementation. Their surviving behavior is either quarantined or read-only admin/view support.

If evidence or implementation context has drifted, use `wiki research bridge` before continuing delivery work. For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After editing repo skill files, run `bun run sync:local`, then `bun run sync:local -- --audit`, then restart the agent session.
