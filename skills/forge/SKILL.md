---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the SDLC lifecycle layer for tracked implementation work. It owns workflow state, slice ownership, Git boundaries, verification evidence, review evidence, handover continuity, and close readiness. Wiki remains the second-brain memory layer; Forge decides whether implementation may proceed or close. Project-specific research belongs under `projects/<project>/research/`; global `research/` is only for reusable cross-project topics.

Health is the cross-cutting inspector/reconciler. It runs freshness, drift, sync, repair, checkpoint, doctor, and readiness checks across Wiki and Forge, but it does not own lifecycle truth. Do not move Health orchestration into shared or lib; shared/lib are only for neutral primitives and contracts.

Use this skill when changing runtime/product behavior, continuing a slice, creating follow-up work, handing over active work, or closing verified work. The CLI and Forge kernel own phase ordering, invariants, and close gates. Do not treat this skill body as workflow truth.

## Real-project operator loop

For production use on an actual project, follow `docs/production-operator-guide.md`: resume for context, checkpoint for freshness/Git truth, `wiki forge next` for the next lifecycle action, `wiki forge status <slice>` for slice truth, explicit TDD red/green evidence, targeted verification, review, and `wiki forge run` for close. If resume reports a stale handover, do not follow the old prompt blindly; re-anchor with checkpoint and Forge status/next first.

## Commands

- Context: `wiki resume <project> --repo <path> --base <rev>` and `wiki handover <project> --repo <path> --base <rev> --summary "<what changed>" --next-action "<workflow action>" --prompt "<operator intent>" [--prd <id>] [--slice <id>] [--command "<runbook command>" ...]`. `wiki agent-handover` is an alias for the same user-facing handover flow.
- Pick/inspect: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice] --repo <path> --json`.
- Health/freshness/repair: `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki maintain <project> --repo <path> --base <rev>`, `wiki doctor <project> --repo <path> --base <rev>`.
- Plan/run: `wiki forge plan <project> <feature-name> --repo <path>`, `wiki forge run <project> [slice-id] --repo <path>`.
- TDD evidence: `wiki forge tdd status <project> <slice> --json`, then `wiki forge tdd red <project> <slice> --test <path> --command "<failing command>" --note "<why this fails>"`, then `wiki forge tdd green <project> <slice> --test <same path> --command "<same command>" --note "<what now passes>"`.
- Verification/review: `wiki forge evidence <project> <slice> verify --command "<targeted command>"`, `wiki forge review record <project> <slice> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name>`.
- Follow-up: `wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--repo <path>]`.

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`; it includes phase, skill, iteration contract, subagent policy, quality gates, and review gates.

Normal chain: `research -> domain-model -> spec -> slices -> ownership -> implementation -> tdd -> verification -> review -> close`, using `wiki research`, `/domain-model`, `wiki forge plan`, `wiki forge start/run/status`, `/tdd`, targeted verification evidence, review evidence, and close gates. `/write-a-prd` and `/prd-to-slices` may help shape the content, but `wiki forge plan` is the command that creates or resumes Forge-owned planning artifacts.

Use subagents only after the plan identifies non-overlapping files or artifacts. If ownership is shared or context handoff would be risky, run the work sequentially.

Dogfood non-trivial repo work with real Forge commands: `next`, explicit `status <slice>`, `checkpoint`, evidence/review records, then `wiki forge run <project> <slice> --repo <path>`. If stale active state disagrees with the latest handover target, trust `resume`/`status` steering and fix the lifecycle state rather than doing ad-hoc work.

`tdd`, targeted verification, required review, and close are not skippable. TDD is explicit record-only evidence: red must be a failed test command, green must be a later passed record using the exact same command and at least one same `--test` path. Do not infer or fake TDD just because `bun test` passes. Research, domain-model, PRD/spec, and slices can be skipped only when the Forge status/rejection packet accepts an explicit audited reason; do not invent a manual bypass.

When verification, review, check, or close fails, do not assume a generic rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the repair path. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

Removed legacy commands are not part of the workflow surface. Use `wiki forge ...` for tracked implementation; old backlog, slice lifecycle, pipeline, gate, and closeout commands are absent from the runtime.

## Creating a handover

A Forge handover is not just a single next prompt. Create it as a structured transfer packet. The generated next-session prompt is for the user: it is printed by the command so the user can copy/paste it into a fresh agent session. The wiki handover stores durable facts, base revision, operator intent, and optional runbook commands; it must not be the only place the user can find the prompt.

1. Refresh before writing: run `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki forge next <project> --repo <path>`, and use `wiki query --bm25` for the latest project memory, related Forge slices, and related PRD. If those disagree with your local notes, fix the lifecycle state or summary before handing over.
2. Write separate fields: `--summary` is what changed and evidence gathered; `--next-action` is the next workflow action/command; `--prompt` is the operator intent for the next model. Do not cram the summary, command, and prompt into one sentence.
3. Attach IDs: pass `--slice <id>` and `--prd <id>` whenever known so the generated next-session prompt includes targeted wiki-query checks and Forge status checks.
4. Add explicit runbook commands with repeated `--command "<cmd with options>"` flags when the next session must run more than one command. Preserve command order; include options inside each quoted command.
5. Keep the user-facing prompt operational: tell the next model to read query hits and Forge truth first, then follow the operator prompt only if it still matches current truth.

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
