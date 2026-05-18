---
name: grill-with-docs
description: Stress-test plans against domain language and ADRs. Use when sharpening terminology, validating plans, or recording architecture decisions.
---

<skill_context>
  <skill_dir>skills/grill-with-docs</skill_dir>
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

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach shared understanding. Ask the questions one at a time, waiting for feedback on each question before continuing. If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Domain awareness

If a `CONTEXT-MAP.md` exists at the root, use it to find per-context glossary files.

## During the session

### Challenge against the glossary
### Sharpen fuzzy language
### Discuss concrete scenarios
### Cross-reference with code
### Update CONTEXT.md inline
### Offer ADRs sparingly

</supporting-info>

# Grill With Docs

Challenge plans against the glossary, ADRs, and concrete code behavior. Resolve dependencies between decisions one-by-one and recommend an answer for each question.

## Domain workflow

- Compare user terms with existing domain language; call out conflicts immediately.
- Sharpen vague language into canonical terms.
- Probe concrete scenarios and edge cases.
- Cross-check claims against code when possible.
- Update CONTEXT.md inline when a term is resolved.
- Offer ADRs only for hard-to-reverse, surprising, real trade-offs.

Use [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) and [ADR-FORMAT.md](./ADR-FORMAT.md).

## Forge integration

Load this skill when the phase packet lists `grill-with-docs`.
CONTEXT.md → `projects/<project>/architecture/domain-language.md`; docs/adr/ → `projects/<project>/adrs/`.
Record stable refs with `wiki forge grill record`.
**After grilling completes:** return to `/forge` — run `wiki forge next` to advance.
