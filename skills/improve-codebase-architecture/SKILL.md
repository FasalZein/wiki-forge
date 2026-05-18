---
name: improve-codebase-architecture
description: Find deepening refactors that improve leverage, locality, and tests. Use when reviewing architecture, seams, modules, or coupling.
---

<skill_context>
  <skill_dir>skills/improve-codebase-architecture</skill_dir>
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

# Improve Codebase Architecture

Surface architectural friction and propose deepening opportunities: refactors that turn shallow modules into deep ones for testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Full definitions in [LANGUAGE.md](LANGUAGE.md).

- Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.
- Deletion test: deleting a shallow module removes complexity; deleting a deep module redistributes complexity.
- The interface is the test surface.
- One adapter = hypothetical seam. Two adapters = real seam.

## Process

1. Read domain language and ADRs first.
2. Explore friction: bouncing between modules, shallow interfaces, leaked seams, tangled callers, and tests that cannot reach behavior.
3. Present numbered candidates with files, problem, solution, benefits, locality, leverage, and test impact.
4. Use CONTEXT.md vocabulary and architecture terms from [LANGUAGE.md](LANGUAGE.md).
5. Do NOT propose interfaces yet. Ask: "Which of these would you like to explore?"
6. In the grilling loop, update CONTEXT.md terms and offer ADRs only for load-bearing decisions.
7. Side effects happen inline as decisions crystallize.

## Zero-tech-debt lens

Optimize for the code that should exist. Search for real callers before preserving compatibility. Delete dead compatibility paths instead of making them better. Verify the intended flow. Replace tests, don't layer them.

## Forge integration

Load this skill when the phase packet lists `improve-codebase-architecture`.
docs/adr/ → projects/<project>/adrs/ with projects/<project>/decisions.md as the index.
File the review in the wiki before (or instead of) creating an external issue; accepted findings become Forge-tracked follow-up work.
**After architecture review completes:** return to `/forge` — run `wiki forge next` to advance.
