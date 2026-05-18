---
name: forge
description: >
  Tracked implementation lifecycle: plan features, own slices, record TDD evidence,
  verify, review, and close. Use when the user says forge, feature, PRD, slice,
  active slice, TDD evidence, review gate, or tracked implementation workflow.
---

## Wiki/Forge session context

For wiki-forge projects:

- Resolve the vault through `KNOWLEDGE_VAULT_ROOT`; if unset, run `wiki config --effective --repo <path>` or `wiki init <project> --repo <path>`.
- Do not create durable project memory markdown inside the code repo unless the repo itself is the configured vault.
- Forge-tracked use: obey the active Forge phase packet, its required skills, artifact owner, allowed writes, and next command.
- Standalone use: this skill can run without Forge; when durable memory is needed, route it through Wiki under `${KNOWLEDGE_VAULT_ROOT}/projects/<project>/`.

# Forge

Forge is the SDLC lifecycle layer for tracked implementation work: feature/PRD/slice planning, active slice ownership, TDD evidence, verification, review gates, and close readiness. Wiki remains the second-brain memory layer; Forge decides whether implementation may proceed or close.

Forge artifacts are vault-owned, not repo-owned. The default project root is `$KNOWLEDGE_VAULT_ROOT/projects/<project>/` (usually `~/Knowledge/projects/<project>/`). Do not create repo-local `forge/`, `wiki/`, or `projects/` folders unless the repo itself is explicitly configured as the Knowledge vault.

Health is the cross-cutting inspector/reconciler for freshness, drift, sync, repair, checkpoint, doctor, and readiness. It does not own lifecycle truth. Do not move Health orchestration into shared or lib; shared/lib are only for neutral primitives and contracts.

## Real-project operator loop

The CLI and Forge kernel own phase ordering, invariants, and close gates. For production use, follow `docs/production-operator-guide.md`: resume for context, checkpoint for freshness/Git truth, `wiki forge next` for the next lifecycle action.

## Operator commands

These are the commands operators and agents use in normal workflow:

| Command | Purpose |
|---------|---------|
| `wiki forge plan <project> <feature-name> [--repo <path>] [--plan-answer-file <path>]` | Plan a feature: grill, PRD, slices |
| `wiki forge next <project>` | Get the next lifecycle action |
| `wiki forge status <project> [slice-id] [--json]` | Inspect workflow truth |
| `wiki forge run <project> [slice-id] --repo <path>` | Execute a slice through close |
| `wiki forge improve <project> [--json]` | Improvement-review phase packet |
| `wiki forge grill record <project> [--context-file <path> [--context <name>]] [--decision-title <title> --decision-file <path>] [--tag <id> ...] [--json]` | Record grill artifact |
| `wiki next <project> [--json]` | Alias for `wiki forge next` |

Context commands:

- Resume: `wiki resume <project> [--repo <path>] [--base <rev>] [--json]`
- Handover: `wiki handover <project> [--repo <path>] [--base <rev>] --summary <text> --next-action <text> --prompt <text> [--prd <id>] [--slice <id>] [--command <cmd> ...] [--json]`
- Health: `wiki checkpoint <project> [--repo <path>] [--base <rev>] [--json]`, `wiki maintain`, `wiki doctor`
- Forge help: `wiki forge help`

## Internal lifecycle commands (phase-packet-driven)

These commands are automated by phase packets. **Do not pick them manually.** Run `wiki forge next` to get the phase packet — it tells you exactly which command to run, with what arguments, and which skill to load.

The internal commands are: `start`, `check`, `close`, `release`, `tdd` (status/cycle/red/green), `evidence`, `review record`, `amend`. Run `wiki forge help` for full signatures.

When a phase packet says to record TDD evidence, use `wiki forge tdd cycle` (preferred) or separate `red`/`green`. When it says to verify, use `wiki forge evidence ... verify`. When it says to review, use `wiki forge review record`. These are not agent choices — they are packet instructions.

## Phase packet contract

Treat `phasePacket` from `wiki forge plan`, `wiki forge next`, and `wiki forge status` as workflow truth. Load the listed skills in order, satisfy the packet's required outputs/evidence, and obey its forbidden fallbacks before advancing. If the packet conflicts with this prose, trust the command packet.

## Contract

Normal chain: `forge plan -> build -> TDD/EDD -> verify -> review -> close`.

**TDD is mandatory.** The close gate rejects without recorded red/green TDD evidence sharing at least one `--test` path. No bypass. Prefer `wiki forge tdd cycle` after observing both results; separate `red`/`green` records must reuse the same command. Do not infer or fake TDD just because `bun test` passes.

TDD, targeted verification, required review, and close are not skippable. Research, grill-with-docs, PRD/spec, and slices can be skipped only when the Forge status/rejection packet accepts an explicit audited reason.

Use subagents only after the plan identifies non-overlapping files **and** a safe lifecycle ownership model. File non-overlap alone is not enough: Forge has one active mutating slice per vault. Never work around the active-slice invariant by formally starting one slice while mutating others. Parallelize read-only scouting, planning, and review freely.

When verification, review, check, or close fails, use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the repair path. Do not assume a generic rerun is correct.

## Handoff

A Forge handoff is a required lifecycle boundary, not an ad-hoc recap. Create one whenever tracked work stops with unfinished work or context risk.

1. Refresh: run `wiki checkpoint` and `wiki forge next` before writing.
2. Write separate fields: `--summary` (what changed), `--next-action` (next command), `--prompt` (operator intent).
3. Attach `--slice` and `--prd` IDs; add `--command "..."` flags for multi-step runbooks.
4. Paste the CLI's copy/paste prompt back to the user verbatim.

If resume reports a stale handover, re-anchor with checkpoint and `wiki forge status/next` first.

## Skill edits

After editing repo skill files, run `bun run sync:full`, then `bun run sync:local -- --audit`, then restart the agent session.
