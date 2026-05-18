---
name: handover
description: >
  Compact the current conversation into a handover document for another agent
  to pick up. Use when ending a session, handing off work, or creating
  continuity for the next agent.
argument-hint: "What will the next session be used for?"
---

Write a handover document so a fresh agent can continue the work without replaying this conversation.

For wiki-forge projects, use `wiki handover` or `wiki agent-handover` to write the durable record under the configured Knowledge vault. Resolve the vault through `KNOWLEDGE_VAULT_ROOT` or `wiki init <project> --repo <path>`.

For standalone use (no wiki-forge project), save to `mktemp -t handover-XXXXXX.md`.

## What to include

- Current objective and next action
- Relevant artifact paths (PRD, slice, commit, test)
- Forge truth commands: `wiki checkpoint`, `wiki forge next`, `wiki forge status`
- Ordered runbook commands the next agent must run
- Skills the next session should load

## What to exclude

- Prior conversation reconstruction
- Broad wiki queries
- Content already in other artifacts — reference by path instead

Suggest skills for the next session. Return the CLI's copy/paste prompt to the user verbatim.
