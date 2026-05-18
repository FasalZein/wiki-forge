# Production Operator Guide

If you are unsure where an artifact belongs, use [Artifact Routing](artifact-routing.md) before writing files.

Before large cleanup/refactor batches, run the [Production Cleanup Readiness](production-cleanup-readiness.md) checklist.

Use this guide when applying wiki-forge to a real project. It is the practical loop; the CLI/kernel remain workflow truth.

## Mental model

- Wiki is the second brain: durable knowledge, research, decisions, source bindings, handovers, retrieval, and page verification.
- Forge is lifecycle truth: feature/PRD/slice ownership, TDD evidence, targeted verification, review, close, and amend.
- Health is the inspector/reconciler: checkpoint, maintain, doctor, drift, sync, readiness, and repair planning.
- Shared/lib are neutral contracts and primitives only. Do not move orchestration there.

## Start or resume

```bash
wiki resume <project> --repo <path> --base <rev>
wiki checkpoint <project> --repo <path> --base <rev>
wiki forge next <project> --repo <path> --json
```

Treat `wiki resume` as context, not freshness truth. `wiki checkpoint` tells you whether the repo/wiki state is clean. `wiki forge next` tells you whether a slice is active, ready, or whether planning is needed.

## Plan new work

When `wiki forge next` returns `plan-next-slice`, create or continue a Forge planning session:

```bash
wiki forge plan <project> <feature-name> --repo <path>
```

Answer one Forge Plan packet: user-visible outcome, explicit non-goals, context/ADR decisions, PRD acceptance criteria, and initial slice breakdown. Keep the first PRD narrow and do not run separate re-interview loops unless a specific field is still unresolved.

## Superseding priorities

A workflow-navigation fix can supersede cleanup or refactor slices when it reduces repeated agent failure, hidden-state probing, or unsafe lifecycle ambiguity. Prefer fixing the CLI/kernel contract before continuing lower-leverage cleanup, because navigation defects compound across every later slice.

Use this decision rule:

1. If the new work makes Forge packets more actionable or prevents agents from guessing lifecycle state, create a new feature/PRD and prioritize it.
2. If the new work is ordinary cleanup, refactor, or docs drift, keep it behind the active workflow-navigation feature unless it blocks the current slice.
3. Always record the supersession reason in the new PRD or slice plan, including which existing feature or slice is being paused and why.
4. Do not abandon the paused work silently; return to `wiki forge next <project> --repo <path> --json` after the superseding slice closes.

## Start a slice

```bash
wiki forge status <project> <slice-id> --repo <path> --json
wiki forge start <project> <slice-id> --repo <path> --agent <agent>
```

Only one mutating slice should be active per vault. File non-overlap is not sufficient for parallel implementation because Forge also owns shared lifecycle state. Parallelize read-only scouting/review, or use isolated worktrees/vaults for truly parallel implementation. Do not formally start one slice while mutating other slices in the same vault.

## TDD red/green

Record TDD evidence explicitly. Forge does not infer TDD from a passing suite.

```bash
wiki forge tdd cycle <project> <slice-id> --test <test-path> --red-command "<failing command>" --green-command "<passing command>" --note "behavior proven red-to-green"
```

If you need to stop after red, use separate `wiki forge tdd red` and `wiki forge tdd green` commands. Red and green records must share at least one same test path; separate records must also use the same command string, while `tdd cycle` may capture different red/green commands under one cycle id.

## Targeted verification and review

Run the slice's targeted verification, then record it:

```bash
wiki forge evidence <project> <slice-id> verify --command "<targeted command>"
wiki forge review record <project> <slice-id> --verdict approved --reviewer <reviewer>
```

Targeted verification proves the slice. Full-suite verification is a release gate or final confidence check, not a replacement for targeted evidence.

## Close

```bash
wiki forge status <project> <slice-id> --repo <path> --json
wiki forge run <project> <slice-id> --repo <path>
```

If close is rejected, follow the typed recovery commands from `wiki forge status` or the rejection packet. Do not manually mark slices done.

## Handover and stale resume recovery

Before stopping or transferring work, refresh durable memory and workflow truth, then write the handover with separate fields:

```bash
wiki checkpoint <project> --repo <path> --base <rev>
wiki forge next <project> --repo <path>
wiki query --bm25 "<project> latest decisions architecture handover"
wiki query --bm25 "<project> <slice-id or Forge slices active ready in-progress>"
wiki query --bm25 "<project> <prd-id or Forge PRD requirements latest>"
wiki agent-handover <project> --repo <path> --base <rev> \
  --summary "<what changed and what evidence exists>" \
  --next-action "<next workflow action>" \
  --command "<first exact command with options>" \
  --command "<second exact command with options>" \
  --prompt "<operator intent for the next model>" \
  --slice <slice-id> --prd <prd-id>
```

`wiki agent-handover` is an alias for `wiki handover` that makes the handoff intent explicit. The generated next-session prompt is printed first as an action-required copy/paste block for a fresh agent session; it is not the durable wiki handover body. In JSON mode, `handoff.requiresUserCopyPaste: true` means the agent must return `handoff.prompt` to the user verbatim. The wiki handover stores facts, base revision, operator intent, and optional runbook commands. The printed prompt intentionally separates context refresh, summary, next action, runbook commands, and operator prompt. The next model must read the referenced handover and Forge status before following handover text; if they disagree, current wiki/Forge truth wins.

If resume reports a stale handover, do not follow the old prompt blindly. Re-anchor on current truth:

```bash
wiki checkpoint <project> --repo <path> --base HEAD --json
wiki forge status <project> --repo <path> --json
wiki forge next <project> --repo <path> --json
```

If checkpoint is clean, stale resume text is context only. If checkpoint reports stale pages or dirty Git state, run repair first.

## Health repair loop

```bash
wiki checkpoint <project> --repo <path> --base <rev>
wiki maintain <project> --repo <path> --base <rev>
wiki doctor <project> --repo <path> --base <rev>
```

Use `checkpoint` for freshness/Git truth, `maintain` for the repair plan, and `doctor` for readiness diagnostics. Health does not close lifecycle work; Forge does.

Recovery blocks are presentation-only. When non-JSON `checkpoint`, `maintain`, or `doctor` output reports dirty, stale, degraded, or actionable state, the CLI prints a `Recovery:` block with copy/paste commands. Follow those commands before continuing lifecycle work. They re-run Health and Forge read models; they do not mutate Forge lifecycle state or mark slices done.

JSON output remains automation-facing. Use `--json` when another tool needs structured checkpoint, maintain, or doctor data; use the non-JSON recovery block when a human operator needs the next safe commands.

The normal recovery chain is checkpoint, maintain, and doctor:

```bash
wiki checkpoint <project> --repo <path> --base HEAD --json
wiki maintain <project> --repo <path> --base HEAD
wiki doctor <project> --repo <path> --base HEAD
wiki forge next <project> --repo <path> --json
```

After repairs or wiki page updates, rerun checkpoint before starting, closing, or handing over Forge work.

## Research placement

Project-specific research lives under `projects/<project>/research/`. Use it for research that exists to support one project's decisions, architecture, PRDs, slices, or handovers.

Global `research/` is only for reusable cross-project topics. Do not file project-bound research under `research/projects/<project>/...`; that path is not a compatibility mode or a canonical location.

```bash
wiki research file <topic> --project <project> <title>
# writes: projects/<project>/research/<topic>/<slug>.md
```

After accepted findings influence implementation, hand them off into project truth (`projects/<project>/decisions` or `projects/<project>/architecture/domain-language`) or bridge them to the active Forge slice.

## Skill updates

After editing repo skills:

```bash
bun run sync:local
bun run sync:local -- --audit
```

Restart the agent session after syncing so installed skills reload. If skills and runtime disagree, trust the CLI/kernel and update the skill text.
