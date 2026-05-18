---
name: prd-to-slices
description: Break PRDs into tracer-bullet Forge slices. Use when converting plans, specs, or PRDs into implementation slices.
---

<skill_context>
  <skill_dir>skills/prd-to-slices</skill_dir>
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

# PRD to Slices

Break a plan into independently grabbable vertical slices using tracer bullets.

## Process

1. Gather context from the conversation or referenced artifact.
2. Explore code if needed; use domain glossary vocabulary and respect ADRs.
3. Draft thin vertical slices that cut through every required integration layer.
4. Mark slices HITL only when human input is truly needed; otherwise prefer AFK.
5. Each slice delivers a narrow but COMPLETE path through the system.
6. Prefer many thin slices over few thick ones.
7. Ask the user whether granularity, dependencies, and HITL/AFK labels are correct.
8. Publish approved slices through Forge in dependency order.

## Slice template

- Parent: feature or PRD reference.
- What to build: concise end-to-end behavior, not layer-by-layer tasks.
- Acceptance criteria.
- Blocked by: blockers or `None - can start immediately`.

Avoid file paths and snippets unless a prototype artifact encodes a decision more precisely than prose.

## Forge integration

Load this skill when the phase packet lists `prd-to-slices`.
Publish slices with `wiki forge plan <project> <feature-name> [--repo <path>]`.
Forge status is workflow truth. Checkpoint/maintain are Health-owned freshness and repair truth.
**After slicing completes:** return to `/forge` — run `wiki forge next` to advance.
