---
name: wiki
description: >
  Second brain for knowledge capture, retrieval, verification, research filing, and freshness repair. Use the `wiki` CLI for wiki-layer work only. For tracked implementation workflow, use the `forge` skill.
---

# Wiki

Wiki is the second-brain memory layer. It owns durable vault memory: research, notes, decisions, handovers, source bindings, page verification levels, drift/freshness checks, and recall. Wiki remembers; Forge executes lifecycle.

The wiki vault is not assumed to be the current repository. Resolve it through the `wiki` CLI; it reads `vault.root` from `~/.config/wiki-forge/config.jsonc` or `KNOWLEDGE_VAULT_ROOT`. Do not create `projects/`, `research/`, `AGENTS.md`, or `CLAUDE.md` under the repo just because the user says "wiki". In this project setup the expected external vault is usually `~/Knowledge`, with project pages under `~/Knowledge/projects/<project>/`.

Project-specific research belongs in `projects/<project>/research/`. Global `research/` is only for reusable cross-project topics. Do not file or recommend project-bound research under `research/projects/<project>/...` or top-level `research/<project>/...`.

Health inspects and reconciles freshness, drift, repair queues, and readiness gates across Wiki and Forge. Public commands still use `wiki checkpoint`, `wiki maintain`, `wiki doctor`, and related verbs; internally this is the Health boundary, not shared/lib utility code.

Use Wiki for project Q&A, research filing, source binding, drift repair, checkpoint/gate review, and maintaining vault truth. If the task shifts into implementation, execution, slice ownership, review gates, or tracked delivery work, switch to `/forge`. The CLI and Forge kernel, not this skill text, own lifecycle enforcement. For real-project operation, follow `docs/production-operator-guide.md` in the repository alongside the current `wiki resume` / `wiki checkpoint` / `wiki forge next` steering.

## Boundary after the Forge P0 overhaul

- Wiki answers: what knowledge exists, what pages are stale, what source bindings need repair, and what context should be retrieved.
- Forge answers: what slice is active, what phase is next, who owns changed files, whether Git/verification/review/ledger evidence permits close, and how to amend closed work.
- Health answers: what repo/wiki freshness, drift, repair, sync, checkpoint, and readiness work is needed before humans or Forge should trust the current state.
- `wiki checkpoint` is freshness/Git truth; it must not be treated as workflow completion.
- `wiki forge status` is workflow truth; it must not be treated as freshness repair.
- Old lifecycle commands are gone from the runtime surface. Tracked implementation closes through `wiki forge run` or explicit `wiki forge check` / `wiki forge close`.

## Commands

- Help: `wiki help` or `wiki help --all`
- Resume context: `wiki resume <project> --repo <path> --base <rev>`
- Ask/search: `wiki ask <project> <question>`, `wiki search <query>`
- Freshness/Git truth: `wiki checkpoint <project> --repo <path> --base <rev>`
- Repair plan: `wiki maintain <project> --repo <path> --base <rev>`
- Reconcile git impact: `wiki refresh-from-git <project> --repo <path> --base <rev>`
- Bind sources: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`
- Verify a page: `wiki verify-page <project> <page> <level>`
- File project research: `wiki research file <topic> --project <project> <title>` writes `projects/<project>/research/<topic>/<slug>.md`
- Ingest project research/source material: `wiki research ingest <topic> --project <project> <source...>` and `wiki source ingest --project <project> --topic <topic> <source...>` write the research note under `projects/<project>/research/...`
- File cross-project research: use global `wiki research file <topic> --global <title>` or global ingest with `--global` only when the topic is reusable beyond one project. Never omit both `--project` and `--global`.
- Migrate old project research: `wiki research migrate-projects [--project <legacy-project>] [--to-project <project>] [--write]` moves legacy `research/projects/<project>/...` notes into `projects/<project>/research/...` after a dry run; use `--to-project` only for an explicit rename/merge decision.
- Handoff research: `wiki research handoff <research-page> <project-truth-page>`
- Bridge research: `wiki research bridge <research-page> --project <project> --slice <slice-id>`
- Workflow status from Forge: `wiki forge status <project> [slice-id] --repo <path>`

If the installed `wiki` binary is unavailable while working inside this repository, use `bun src/index.ts ...` from the repo root as the equivalent CLI entrypoint.

## Rules

- `wiki checkpoint` is the authoritative freshness/Git source for current vault truth.
- `wiki maintain` is the authoritative repair plan for freshness repair and reconciliation work.
- `wiki resume` restores working context only; use it to recover orientation, not to override current freshness truth. If it reports a stale handover, re-anchor with `wiki checkpoint <project> --repo <path> --base HEAD --json` and `wiki forge status` / `wiki forge next` before acting.
- Do not hand-edit freshness metadata or generated pages when a `wiki` command owns that surface.
- If git activity may have changed repo truth, use `wiki checkpoint`, `wiki maintain`, or `wiki refresh-from-git` instead of manually patching derived wiki state.
- Keep wiki focused on knowledge-state operations. Use `/forge` for implementation planning, execution, amendment slices, review gates, and tracked SDLC workflow.
- Do not use or advertise removed legacy lifecycle commands. They are absent from the runtime; use the `wiki forge ...` surface instead.
- After editing repo skill files such as `skills/*/SKILL.md`: run `bun run sync:wiki` for a wiki-only install or `bun run sync:full` for the full Wiki+Forge workflow install, optionally audit with `bun run sync:local -- --audit`, then restart the agent session.
