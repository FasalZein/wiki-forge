---
name: wiki
description: Second-brain vault memory for retrieval, freshness, research, and handovers. Use when orienting project memory, vault root, wiki, or knowledge context.
---

<skill_context>
  <skill_dir>skills/wiki</skill_dir>
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

# Wiki

Wiki is the second-brain memory layer. Wiki remembers; Forge executes lifecycle.

Use this skill for knowledge repository work: vault root orientation, retrieval, source binding, research filing, handovers, freshness repair, and project memory questions. For real-project operation, follow `docs/production-operator-guide.md`.

## Boundary

- Wiki owns durable vault knowledge: notes, research, source bindings, handovers, recall, freshness, and drift.
- Forge owns tracked implementation: feature/PRD/slice state, active slice ownership, evidence, review, and close gates.
- Health inspects and reconciles freshness, drift, repair queues, and readiness gates across Wiki and Forge.
- `wiki checkpoint` is freshness/Git truth, not workflow completion.
- `wiki forge status` and `wiki forge next` are workflow truth, not freshness repair.
- Tracked implementation closes through `wiki forge run`.

## Vault rules

The wiki vault is not assumed to be the current repository. Resolve it through `wiki config --effective --repo <path>`, `wiki init <project> --repo <path>`, or `wiki resume <project> --repo <path> --base HEAD`.

Do not create `projects/`, `wiki/`, or `forge/` folders under the repo just because the user says wiki or forge. Project memory belongs under `$KNOWLEDGE_VAULT_ROOT/projects/<project>/` unless the configured vault is explicitly the repository.

Project research goes under `projects/<project>/research/`. Global research is only for reusable cross-project topics.

## Commands

- Orient: `wiki init <project> --repo <path>`, `wiki config --effective --repo <path>`, `wiki resume <project> --repo <path> --base HEAD`
- Retrieve: `wiki ask <project> <question>`, `wiki search <query>`
- Freshness/repair: `wiki checkpoint <project> --repo <path> --base <rev>`, `wiki maintain <project> --repo <path> --base <rev>`, `wiki doctor <project> --repo <path> --base <rev>`
- Research/source: `wiki research file|ingest ... --project <project>` and `wiki source ingest --project <project> --topic <topic> ...`
- Workflow truth from Forge: `wiki forge next <project> --repo <path>`, `wiki forge status <project> [slice-id] --repo <path>`

## Phase packet contract

If a Forge `phasePacket` is present, do not override it with wiki-layer guesses. Use Wiki only for the packet's context, vault, freshness, or memory needs, then return to Forge.

## Forge integration

Load this skill when work is memory, freshness, vault, research, or handover oriented.
If the task becomes tracked implementation, return to `/forge`.
Run `wiki forge next` or `wiki forge status` instead of inventing workflow steps.

## Skill edits

After editing repo skill files, run `bun run sync:full`, then `bun run sync:local -- --audit`, then restart the agent session.
