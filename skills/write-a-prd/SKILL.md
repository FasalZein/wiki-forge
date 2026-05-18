---
name: write-a-prd
description: Synthesize current context into a Forge PRD. Use when the user wants a PRD, product spec, or plan captured for delivery.
---

<skill_context>
  <skill_dir>skills/write-a-prd</skill_dir>
  <workspace_dir>/Users/tothemoon/Dev/code-forge/knowledge-wiki-system</workspace_dir>

  <path_policy>
    Relative file references in this SKILL.md normally resolves from skill_dir when they exist there.
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

# Write a PRD

This skill turns current conversation context and codebase understanding into a PRD. Do NOT interview the user; synthesize what is already known.

## Process

1. Explore the repo if needed. Use the project's domain glossary vocabulary throughout the PRD and respect ADRs.
2. Identify modules to build or modify and opportunities for deep, testable modules.
3. Check with the user that the module set and testing focus match expectations.
4. Write the PRD and publish it through Forge.

## PRD template

- Problem Statement: user-facing problem.
- Solution: user-facing solution.
- User Stories: numbered `As an <actor>, I want <feature>, so that <benefit>` stories.
- Implementation Decisions: modules, interfaces, clarifications, schema, contracts, and interactions.
- Testing Decisions: behavior-test strategy, modules covered, and prior art.
- Out of Scope.
- Further Notes.

Do NOT include specific file paths or code snippets unless a prototype snippet encodes a decision more precisely than prose.

## Forge integration

Load this skill when the phase packet lists `write-a-prd`.
`wiki forge plan` owns feature/PRD/slice artifact creation.
Use `wiki forge plan <project> <feature-name> [--repo <path>]` for publishing.
**After PRD synthesis completes:** return to `/forge` — run `wiki forge next` to advance.
