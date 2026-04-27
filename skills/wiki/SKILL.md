---
name: wiki
description: >
  Second brain for knowledge capture, retrieval, verification, research filing, and freshness repair. Use the `wiki` CLI for wiki-layer work only. For tracked implementation workflow, use the `forge` skill.
---

# Wiki

Wiki is the knowledge, retrieval, freshness, and verification layer. It owns vault truth: research, bindings, page verification levels, drift/freshness checks, and repair plans.

Use it for project Q&A, research filing, source binding, drift repair, checkpoint/gate review, and maintaining vault truth. If the task shifts into implementation, execution, slice ownership, review gates, or tracked delivery work, switch to `/forge`.

## Boundary after the Forge P0 overhaul

- Wiki answers: what knowledge exists, what pages are stale, what source bindings need repair, and what context should be retrieved.
- Forge answers: what slice is active, what phase is next, who owns changed files, whether Git/verification/review/ledger evidence permits close, and how to amend closed work.
- `wiki checkpoint` is freshness/Git truth; it must not be treated as workflow completion.
- `wiki forge status` is workflow truth; it must not be treated as freshness repair.
- `wiki closeout` / `wiki gate` surface closure attestation, but tracked implementation should normally close through `wiki forge run`.

## Commands

- Help: `wiki help` or `wiki help --all`
- Resume context: `wiki resume <project> --repo <path> --base <rev>`
- Ask/search: `wiki ask <project> <question>`, `wiki search <query>`
- Freshness/Git truth: `wiki checkpoint <project> --repo <path> --base <rev>`
- Repair plan: `wiki maintain <project> --repo <path> --base <rev>`
- Reconcile git impact: `wiki refresh-from-git <project> --repo <path> --base <rev>`
- Bind sources: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`
- Verify a page: `wiki verify-page <project> <page> <level>`
- File research: `wiki research file <topic> --project <project> <title>`
- Handoff research: `wiki research handoff <research-page> <project-truth-page>`
- Bridge research: `wiki research bridge <research-page> --project <project> --slice <slice-id>`
- Closeout/gate review: `wiki closeout <project> --repo <path> --base <rev>`, `wiki gate <project> --repo <path> --base <rev>`

If the installed `wiki` binary is unavailable while working inside this repository, use `bun src/index.ts ...` from the repo root as the equivalent CLI entrypoint.

## Rules

- `wiki checkpoint` is the authoritative freshness/Git source for current vault truth.
- `wiki maintain` is the authoritative repair plan for freshness repair and reconciliation work.
- `wiki resume` restores working context only; use it to recover orientation, not to override current freshness truth.
- Do not hand-edit freshness metadata or generated pages when a `wiki` command owns that surface.
- If git activity may have changed repo truth, use `wiki checkpoint`, `wiki maintain`, or `wiki refresh-from-git` instead of manually patching derived wiki state.
- Keep wiki focused on knowledge-state operations. Use `/forge` for implementation planning, execution, amendment slices, review gates, and tracked SDLC workflow.
- After editing repo skill files such as `skills/*/SKILL.md`: run `bun run sync:local`, optionally `bun run sync:local -- --audit`, then restart the agent session.
