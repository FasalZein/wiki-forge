---
name: forge
description: Tracked implementation lifecycle for features, slices, evidence, review, and close. Use when planning, running, or closing delivery work.
---

<skill_context>
  <skill_dir>skills/forge</skill_dir>
  <workspace_dir>/Users/tothemoon/Dev/code-forge/knowledge-wiki-system</workspace_dir>

  <path_policy>
    Relative file references in this SKILL.md normally resolve from skill_dir when they exist there.
    Plain workspace commands like git status and bun test usually run in the workspace unless instructed otherwise.
    Use $PI_SKILL_DIR/path for explicit bundled skill files.
    Use $PI_WORKSPACE/path for explicit workspace/project files.
  </path_policy>
</skill_context>

## Wiki/Forge session context

For wiki-forge projects:

- Resolve the vault through `KNOWLEDGE_VAULT_ROOT`; if unset, run `wiki config --effective --repo <path>` or `wiki init <project> --repo <path>`.
- Do not create durable project memory markdown inside the code repo unless the repo itself is the configured vault.
- Forge-tracked use: obey the active Forge phase packet, its required skills, artifact owner, allowed writes, and next command.
- Standalone use: this skill can run without Forge; when durable memory is needed, route it through Wiki under `${KNOWLEDGE_VAULT_ROOT}/projects/<project>/`.

# Forge

Forge is the SDLC lifecycle layer for tracked implementation work. It owns feature/PRD/slice state, active slice ownership, Git boundaries, TDD/verification/review evidence, handovers, amendments, and close readiness. The CLI and Forge kernel own phase ordering, invariants, and close gates.

Forge artifacts are vault-owned. Resolve the vault with `wiki init`, `wiki resume`, `wiki forge next/status`, or `wiki config --effective`. Do not create repo-local `forge/`, `wiki/`, or `projects/` folders.

Health is the cross-cutting inspector/reconciler. Do not move Health orchestration into shared or lib.

## Real-project operator loop

Use the operator commands below for production work; internal commands are phase-packet details.

## Operator commands

- Orient/freshness: `wiki resume <project> --repo <path> --base <rev>`, `wiki checkpoint <project> --repo <path> --base <rev>`
- Inspect: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice] --repo <path> --json`, `wiki forge help`
- Plan/run: `wiki forge plan <project> <feature-name> --repo <path>`, `wiki forge run <project> [slice-id] --repo <path>`
- Improve/grill: `wiki forge improve <project> --json`, `wiki forge grill record <project> ... --json`

## Internal lifecycle commands (phase-packet-driven)

`wiki forge start`, `release`, `check`, `close`, `tdd`, `evidence`, `review`, and `amend` are internal/repair commands. Do not pick them manually; use them only when the phase packet, repair packet, active slice gate, or explicit runbook says to.

## Phase packet contract

Treat `phasePacket` from `wiki forge plan`, `wiki forge next`, and `wiki forge status` as workflow truth. If prose conflicts with a packet, follow the packet.

Normal chain: forge plan -> build -> TDD/EDD -> verify -> review -> close.

TDD is mandatory. Targeted verification, review, and close are not skippable. Passing tests alone do not close work.

Use one `wiki forge plan` packet for planning context, PRD content, and slices. Then follow `wiki forge next/status`, the listed skill chain, evidence commands, review gate, and `wiki forge run`.

## Subagents and ownership

Use subagents only after the plan identifies non-overlapping work and a safe lifecycle ownership model. File non-overlap alone is not enough. There is one active mutating slice per vault. Never work around the active-slice invariant.

## Failure handling

When verification, review, check, or close fails, do not blindly rerun. Use `wiki forge status <project> <slice> --json`, `wiki checkpoint`, and `wiki maintain` to repair truth.

## Handoffs

Create a handover when work stops unfinished or context risk is high. Use `wiki handover`/`wiki agent-handover` with summary, next action, slice/PRD IDs, and ordered commands. Return the CLI copy/paste prompt verbatim.

## Forge integration

Load this skill for tracked implementation work.
After Forge work completes: run `wiki forge next` to discover the next lifecycle action.
Use `/wiki` only for memory, freshness, vault, or research context.

## Skill edits

After editing repo skill files, run `bun run sync:full`, then `bun run sync:local -- --audit`, then restart the agent session.
