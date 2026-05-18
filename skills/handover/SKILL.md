---
name: handover
description: Compact current work into a next-agent handover. Use when ending a session, transferring work, or preserving continuity.
argument-hint: "What will the next session be used for?"
---

<skill_context>
  <skill_dir>skills/handover</skill_dir>
  <workspace_dir>/Users/tothemoon/Dev/code-forge/knowledge-wiki-system</workspace_dir>

  <path_policy>
    Relative file references in this SKILL.md normally resolve from skill_dir when they exist there.
    Plain workspace commands like git status and bun test usually run in the workspace unless instructed otherwise.
    Use $PI_SKILL_DIR/path for explicit bundled skill files.
    Use $PI_WORKSPACE/path for explicit workspace/project files.
  </path_policy>
</skill_context>

# Handover

Write a handover document so a fresh agent can continue without replaying this conversation.

For wiki-forge projects, use `wiki handover` or `wiki agent-handover` to write the durable record under the configured Knowledge vault. Resolve the vault through `KNOWLEDGE_VAULT_ROOT` or `wiki init <project> --repo <path>`.

For standalone use, save to `mktemp -t handover-XXXXXX.md`.

## What to include

- Current objective and next action.
- Relevant artifact paths: PRD, slice, commit, test, handover.
- Forge truth commands: `wiki checkpoint`, `wiki forge next`, `wiki forge status`.
- Ordered runbook commands for the next agent.
- Skills the next session should load.

## What to exclude

- Prior conversation reconstruction.
- Broad wiki queries.
- Content already in other artifacts; reference by path instead.

Suggest skills for the next session. Return the CLI's copy/paste prompt to the user verbatim.

## Forge integration

Load this skill when a Forge session is ending or transferring.
Use `wiki handover`/`wiki agent-handover` for durable records.
Include `wiki forge next` in the runbook.
**After handover completes:** return to `/forge` — run `wiki forge next` to advance.
