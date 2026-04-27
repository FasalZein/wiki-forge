---
name: wiki
description: >
  Second brain for knowledge capture, retrieval, verification, research filing, and freshness repair. Use the `wiki` CLI for wiki-layer work only. For tracked implementation workflow, use the `forge` skill.
---

# Wiki

Wiki is the knowledge, retrieval, freshness, and verification layer.

Use it for project Q&A, research filing, source binding, drift repair, checkpoint/gate review, and maintaining vault truth. If the task shifts into implementation, execution, or tracked delivery work, switch to `/forge`.

## Commands

- Help: `wiki help` or `wiki help --all`
- Resume context: `wiki resume <project> --repo <path> --base <rev>`
- Ask/search: `wiki ask <project> <question>`, `wiki search <query>`
- Freshness truth: `wiki checkpoint <project> --repo <path>`
- Repair plan: `wiki maintain <project> --repo <path> --base <rev>`
- Reconcile git impact: `wiki refresh-from-git <project> --repo <path> --base <rev>`
- Bind sources: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`
- Verify a page: `wiki verify-page <project> <page> <level>`
- File research: `wiki research file <topic> --project <project> <title>`
- Handoff research: `wiki research handoff <research-page> <project-truth-page>`
- Bridge research: `wiki research bridge <research-page> --project <project> --slice <slice-id>`
- Closeout/gate review: `wiki closeout <project> --repo <path> --base <rev>`, `wiki gate <project> --repo <path> --base <rev>`

## Rules

- `wiki checkpoint` is the authoritative freshness source for current vault truth.
- `wiki maintain` is the authoritative repair plan for freshness repair and reconciliation work.
- `wiki resume` restores working context only; use it to recover orientation, not to override current freshness truth.
- Do not hand-edit freshness metadata or generated pages when a `wiki` command owns that surface.
- If git activity may have changed repo truth, use `wiki checkpoint`, `wiki maintain`, or `wiki refresh-from-git` instead of manually patching derived wiki state.
- Keep wiki focused on knowledge-state operations. Use `/forge` for implementation planning, execution, and tracked SDLC workflow.
- After editing repo skill files such as `skills/*/SKILL.md`: run `bun run sync:local`, optionally `bun run sync:local -- --audit`, then restart the agent session.
