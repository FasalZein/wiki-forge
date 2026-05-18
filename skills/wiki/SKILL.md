---
name: wiki
description: >
  Second brain / Knowledge vault for project memory, retrieval, freshness repair,
  source binding, and vault orientation. Use when the user says wiki, vault,
  second brain, project memory, retrieve context, refresh wiki, or asks where
  project knowledge lives. For tracked implementation, use the `forge` skill.
---

## Wiki/Forge session context

For wiki-forge projects:

- Resolve the vault through `KNOWLEDGE_VAULT_ROOT`; if unset, run `wiki config --effective --repo <path>` or `wiki init <project> --repo <path>`.
- Do not create durable project memory markdown inside the code repo unless the repo itself is the configured vault.
- Forge-tracked use: obey the active Forge phase packet, its required skills, artifact owner, allowed writes, and next command.
- Standalone use: this skill can run without Forge; when durable memory is needed, route it through Wiki under `${KNOWLEDGE_VAULT_ROOT}/projects/<project>/`.

# Wiki

Wiki is the second-brain memory layer — a knowledge repository for durable vault memory: research, notes, decisions, handovers, source bindings, page verification levels, drift/freshness checks, and recall. Wiki remembers; Forge executes lifecycle.

## Vault orientation

The wiki vault is not assumed to be the current repository. Resolve it through the `wiki` CLI; it reads `vault.root` from `~/.config/wiki-forge/config.jsonc` or `KNOWLEDGE_VAULT_ROOT`. Do not create `projects/`, `wiki/`, or `forge/` folders under the repo just because the user says "wiki" or "forge". The expected external vault root is usually `~/Knowledge`, with project pages under `~/Knowledge/projects/<project>/`.

When orientation is unclear, run `wiki init <project> --repo <path>` first. Use `wiki config --effective --repo <path>` or `wiki resume <project> --repo <path> --base HEAD` before writing existing project memory. The right project memory root is `$KNOWLEDGE_VAULT_ROOT/projects/<project>/`, not `<repo>/projects/<project>/`, unless the configured vault root is explicitly the repository.

Project-specific research belongs in `projects/<project>/research/`. Global `research/` is only for reusable cross-project topics.

## Boundary

- **Wiki answers:** what knowledge exists, what pages are stale, what source bindings need repair, what context to retrieve.
- **Forge answers:** what slice is active, what phase is next, who owns changed files, whether evidence permits close.
- **Health answers:** what freshness, drift, repair, sync, checkpoint, and readiness work is needed.

Health inspects and reconciles freshness, drift, repair queues, and readiness gates across Wiki and Forge. Public commands: `wiki checkpoint`, `wiki maintain`, `wiki doctor`. This is the Health boundary, not shared/lib utility code.

`wiki checkpoint` is freshness/Git truth — not workflow completion.
`wiki forge status` is workflow truth — not freshness repair.
Tracked implementation closes through `wiki forge run` or explicit `wiki forge check` / `wiki forge close`.

If a task becomes tracked implementation, switch to `/forge` and follow `wiki forge next/status`. For real-project operation, follow `docs/production-operator-guide.md` alongside the current `wiki resume` / `wiki checkpoint` / `wiki forge next` steering.

## Phase packet contract

Wiki can orient, refresh, and retrieve context, but it does not supersede Forge phase packets. If a Forge `phasePacket` is present, do not override it with wiki-layer guesses. Use wiki commands only to satisfy the packet's context/freshness needs, then return to the listed Forge command.

## Commands

- Help: `wiki help` or `wiki help --all` or `wiki --version`
- Resume: `wiki resume <project> [--repo <path>] [--base <rev>] [--json]`
- Orientation: `wiki init <project> [--repo <path>]`, `wiki scaffold-project <project>`
- Ask/search: `wiki ask <project> <question...>`, `wiki search [--hybrid] <query...>`
- Freshness: `wiki checkpoint <project> [--repo <path>] [--base <rev>] [--json]`
- Repair: `wiki maintain <project> [--repo <path>] [--base <rev>] [--json]`
- Git reconcile: `wiki refresh-from-git <project> [--repo <path>] [--base <rev>] [--json]`
- Bind sources: `wiki bind <project> <module-or-page> <source-path...> [--mode replace|merge] [--dry-run]`
- Verify page: `wiki verify-page <project> <module-or-page...> <level> [--dry-run] [--allow-downgrade]`
- Drift check: `wiki drift-check <project> [--repo <path>] [--show-unbound] [--fix] [--json]`
- File research: `wiki research file <topic> [--project <project>] <title...>`
- Ingest research: `wiki research ingest <topic> --project <project> <source-url-or-path...>`
- Handoff research: `wiki research handoff <research-page> <projects/<project>/decisions|projects/<project>/architecture/domain-language>`
- Bridge research: `wiki research bridge <research-page> --project <project> --slice <slice-id> [--json]`
- Forge status: `wiki forge status <project> [slice-id] [--json]`

If the installed `wiki` binary is unavailable while working inside this repository, use `bun src/index.ts ...` from the repo root.

## Rules

- `wiki checkpoint` is the authoritative freshness/Git source. `wiki maintain` is the authoritative repair plan.
- `wiki resume` restores working context only. If it reports a stale handover, re-anchor with `wiki checkpoint` and `wiki forge status/next`.
- Do not hand-edit freshness metadata or generated pages when a `wiki` command owns that surface.
- Do not pass command words (`note`, `plan`, `status`) as project names. Use the canonical slug from `projects/<project>/`.
- Keep wiki focused on knowledge-state operations. Use `/forge` for implementation.
- After editing repo skill files: run `bun run sync:full`, then `bun run sync:local -- --audit`, then restart the agent session.
