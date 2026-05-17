---
name: forge
description: >
  Forge workflow for tracked implementation work: feature/PRD/slice planning, active slice ownership, release/start/close, TDD evidence, targeted verification, review gates, handovers, amendments, and `wiki forge ...` commands. Trigger when the user says forge, continue wiki-forge, feature, PRD, slice, active slice, release/start/close, handover, TDD evidence, review gate, or tracked implementation workflow.
---

## Wiki/Forge session context

For wiki-forge projects:

- Resolve the vault through `KNOWLEDGE_VAULT_ROOT`; if unset, run `wiki config --effective --repo <path>` or `wiki init <project> --repo <path>`.
- Do not create durable project memory markdown inside the code repo unless the repo itself is the configured vault.
- Forge-tracked use: obey the active Forge phase packet, its required skills, artifact owner, allowed writes, and next command.
- Standalone use: this skill can run without Forge; when durable memory is needed, route it through Wiki under `${KNOWLEDGE_VAULT_ROOT}/projects/<project>/`.

# Forge

Forge is the SDLC lifecycle layer for tracked implementation work. It owns workflow state, slice ownership, Git boundaries, verification evidence, review evidence, handover continuity, and close readiness. Wiki remains the second-brain memory layer; Forge decides whether implementation may proceed or close. Project-specific research belongs under `projects/<project>/research/`; global `research/` is only for reusable cross-project topics.

Forge artifacts are vault-owned, not repo-owned. Resolve the Knowledge vault through `wiki init <project> --repo <path>`, `wiki resume`, `wiki forge next/status`, or `wiki config --effective`; the default project root is `$KNOWLEDGE_VAULT_ROOT/projects/<project>/` (usually `~/Knowledge/projects/<project>/`). Do not create repo-local `forge/`, `wiki/`, or `projects/` folders unless the repo itself is explicitly configured as the Knowledge vault.

Health is the cross-cutting inspector/reconciler. It runs freshness, drift, sync, repair, checkpoint, doctor, and readiness checks across Wiki and Forge, but it does not own lifecycle truth. Do not move Health orchestration into shared or lib; shared/lib are only for neutral primitives and contracts.

Use this skill when changing runtime/product behavior, continuing a slice, creating follow-up work, handing over active work, or closing verified work. The CLI and Forge kernel own phase ordering, invariants, and close gates. Do not treat this skill body as workflow truth.

## Real-project operator loop

For production use on an actual project, follow `docs/production-operator-guide.md`: resume for context, checkpoint for freshness/Git truth, `wiki forge next` for the next lifecycle action, `wiki forge status <slice>` for slice truth, explicit TDD red/green evidence, targeted verification, review, and `wiki forge run` for close. If resume reports a stale handover, do not follow the old prompt blindly; re-anchor with checkpoint and Forge status/next first.

## Commands

- Context: `wiki resume <project> --repo <path> --base <rev>` and `wiki handover <project> --repo <path> --base <rev> --summary "<what changed>" --next-action "<workflow action>" --prompt "<operator intent>" [--prd <id>] [--slice <id>] [--command "<runbook command>" ...]`. `wiki agent-handover` is an alias for the same user-facing handover flow.
- Pick/inspect: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice] --repo <path> --json`, `wiki forge improve <project> [--json]` for the explicit improvement-review phase packet.
- Health/freshness/repair: `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki maintain <project> --repo <path> --base <rev>`, `wiki doctor <project> --repo <path> --base <rev>`.
- Plan/run: `wiki forge plan <project> <feature-name> --repo <path>`, `wiki forge run <project> [slice-id] --repo <path>`.
- Low-friction planning answers: prefer one `--plan-answer-file <path>` containing outcome, non-goals, context/decisions, PRD acceptance criteria, and initial slice breakdown. Legacy `--torpathy-answer-file`, `--grill-with-docs-answer-file`, and `--prd-grill-answer-file` remain compatibility inputs only. Avoid shell heredocs inside command arguments.
- Grill artifact recording: use `wiki forge grill record <project> --context-file <path> --decision-title <title> --decision-file <path> --tag <PRD-or-slice-id> --json` to write context to `projects/<project>/architecture/domain-language.md` or context pages indexed from `projects/<project>/architecture/context-map.md`, write ADR bodies under `projects/<project>/adrs/`, and maintain `projects/<project>/decisions.md` as the index.
- TDD evidence: `wiki forge tdd status <project> <slice> --json`, then preferably `wiki forge tdd cycle <project> <slice> --test <path> --red-command "<failing command>" --green-command "<passing command>" --note "<behavior proven>"`. Use separate `red`/`green` only when you need to stop between observations.
- Verification/review: `wiki forge evidence <project> <slice> verify --command "<targeted command>"`, `wiki forge review record <project> <slice> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name>`.
- Follow-up: `wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--repo <path>]`.

## Phase packet contract

Treat `phasePacket` from `wiki forge plan`, `wiki forge next`, and `wiki forge status` as workflow truth. Load the listed skills in order, satisfy the packet's required outputs/evidence, and obey its forbidden fallbacks before advancing. If the packet conflicts with this prose, trust the command packet and use Forge status/checkpoint to repair stale context.

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`; it includes phase, skill, iteration contract, subagent policy, quality gates, review gates, and phase packets.

Normal chain: `forge plan -> build -> TDD/EDD -> verify -> review -> close`. Use `wiki research` only when outside evidence is needed. Use one `wiki forge plan` packet to capture grill-with-docs context, ADR-style decisions, PRD content, and initial slices. Then use `wiki forge start/run/status`, `/tdd`, targeted verification evidence, review evidence, and close gates. `/write-a-prd` and `/prd-to-slices` may help shape content, but they are helpers inside Plan, not separate user-interview loops.

Use subagents only after the plan identifies non-overlapping files or artifacts **and** a safe lifecycle ownership model. File non-overlap alone is not enough: Forge has shared vault state and one active mutating slice per vault. Parallelize read-only scouting, planning, and review freely; parallelize implementation only in isolated worktrees/vaults or with an explicit Forge/kernel parallel execution grant. Never work around the active-slice invariant by formally starting one slice while mutating others.

Dogfood non-trivial repo work with real Forge commands: `next`, explicit `status <slice>`, `checkpoint`, evidence/review records, then `wiki forge run <project> <slice> --repo <path>`. If stale active state disagrees with the latest handover target, trust `resume`/`status` steering and fix the lifecycle state rather than doing ad-hoc work.

`tdd`, targeted verification, required review, and close are not skippable. TDD is explicit record-only evidence: red must be a failed test command, green must be a later passed record, and both must share at least one same `--test` path. Prefer `wiki forge tdd cycle` after observing both results; separate red/green records must also reuse the same command. Do not infer or fake TDD just because `bun test` passes. Research, grill-with-docs, PRD/spec, and slices can be skipped only when the Forge status/rejection packet accepts an explicit audited reason; do not invent a manual bypass.

When verification, review, check, or close fails, do not assume a generic rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the repair path. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

Removed legacy commands are not part of the workflow surface. Use `wiki forge ...` for tracked implementation; old backlog, slice lifecycle, pipeline, gate, and closeout commands are absent from the runtime.

## Creating a handoff

A Forge handoff is a required lifecycle boundary, not an ad-hoc recap. Create or update a handover whenever a tracked implementation session stops with unfinished work, context risk, an interruption, or a closeout that still needs the next operator to continue. Do not wait for the user to explicitly ask for a handover when Forge work is being transferred.

The wiki CLI stores the durable markdown record and prints the next-session prompt separately. Forge owns the policy: handoffs must be compact, artifact-first, and operational. The generated prompt should route the next model to the handover record, Forge truth, and explicitly referenced artifacts; it must not ask the next model to reconstruct the prior conversation or run broad wiki queries by default. After creating a handover, paste the CLI's `Copy/paste prompt for the next agent session` back to the user verbatim; do not tell the user only that the file was written.

1. Refresh before writing: run `wiki checkpoint <project> --repo <path> --base <rev>` and `wiki forge next <project> --repo <path>`. Use targeted `wiki forge status` for known slices. Use `wiki query --bm25` only when a needed artifact/reference is missing or stale. If current truth disagrees with your local notes, fix the lifecycle state or summary before handing over.
2. Write separate fields: `--summary` is what changed and evidence gathered; `--next-action` is the next workflow action/command; `--prompt` is the operator intent for the next model. Do not cram the summary, command, and prompt into one sentence.
3. Attach IDs: pass `--slice <id>` and `--prd <id>` whenever known so the durable record and generated prompt can point at precise artifacts and status checks instead of broad memory searches.
4. Add explicit runbook commands with repeated `--command "<cmd with options>"` flags when the next session must run more than one command. Preserve command order; include options inside each quoted command.
5. Keep the user-facing prompt lean: it should say not to reconstruct the prior conversation, read only the handover/current Forge truth/explicit artifacts, and follow the operator intent only if it still matches current truth.
6. If using `--json`, check `handoff.requiresUserCopyPaste`. When true, surface `handoff.prompt`/`nextSessionPrompt` to the user as a fenced copy/paste block. The durable handover file must not contain that generated prompt.

Example:

```bash
wiki agent-handover wiki-forge --repo . --base HEAD \
  --slice WIKI-FORGE-123 --prd PRD-045 \
  --summary "Implemented X, recorded TDD red/green, targeted test passes." \
  --next-action "Run status, then record review evidence." \
  --command "wiki forge status wiki-forge WIKI-FORGE-123 --repo . --json" \
  --command "wiki forge review record wiki-forge WIKI-FORGE-123 --verdict approved --reviewer codex" \
  --prompt "Continue the review gate for WIKI-FORGE-123; do not start unrelated refactors."
```

If evidence or implementation context has drifted, use `wiki research bridge` before continuing delivery work. For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After editing repo skill files, run `bun run sync:full`, then `bun run sync:local -- --audit`, then restart the agent session. Use `bun run sync:wiki` only when intentionally keeping a wiki-only install without Forge workflow skills.
