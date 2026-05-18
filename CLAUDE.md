---
managed_by: wiki-forge
orientation_version: 2
project: wiki-forge
scope: root
applies_to: .
vault_root: /Users/tothemoon/Knowledge
project_wiki_root: projects/wiki-forge
updated: 2026-05-15T20:59:26.952Z
---
<!-- wiki-forge:orientation:start -->
# Wiki Project Orientation

> Managed by wiki-forge. Keep local repo-specific notes below the managed block.
> `AGENTS.md` and `CLAUDE.md` carry the same wiki-managed orientation block. Do not treat them as separate policy sources.

Scope: repo root
Knowledge vault root: `/Users/tothemoon/Knowledge`
Project wiki root: `/Users/tothemoon/Knowledge/projects/wiki-forge`

Do not create wiki pages under the repository unless the repository itself is the configured Knowledge vault. Use the `wiki` CLI so paths resolve through `KNOWLEDGE_VAULT_ROOT`.

Use `/forge` for non-trivial implementation work.
Use `/wiki` for retrieval, refresh, drift, verification, and closeout review.
If slash-skill aliases are unavailable, run the equivalent `wiki` CLI lifecycle directly.
Use `wiki init <project> --repo <path>` for repo/vault orientation; AGENTS.md and CLAUDE.md updates are wiki-owned internals, not operator commands.

## Code Quality

Codex (GPT-5-class reviewer) reviews every change before it merges. Write as if a stricter reviewer is watching:
- Smaller, more focused diffs. Every changed line should trace to the task.
- Honest names. No `foo`, no `handleStuff`, no vague `utils`.
- Tight types. No `any`, no unchecked casts, no silent `as unknown as T`.
- Real error handling. No bare `catch {}`, no swallowed promises, no placeholder throw sites.
- Tests that describe behavior, not implementation. Delete shallow tests you replace.
- Match the surrounding style even when you'd design differently.

Sloppy code costs a review round-trip. Writing it right the first time is faster than arguing with a reviewer.

## Skill Routing

- When the user says "wiki" in any context → load `/wiki` skill.
- When the user says "forge", "feature", "slice", or "PRD" → load `/forge` skill.
- When implementing, building, or fixing non-trivial work → load `/forge` skill.
- All project artifacts (PRDs, slices, handovers, research) are created through the `wiki` CLI, never by writing markdown files directly.

## Vault Guardrails

- NEVER create `projects/`, `wiki/`, `forge/`, or `research/` folders under the code repository.
- All project memory lives under `/Users/tothemoon/Knowledge/projects/wiki-forge/`.
- Use the `wiki` CLI to create and manage vault artifacts. Direct file writes to the vault are forbidden unless the CLI delegates them.

## Workflow Enforcement

Load `/forge` for tracked slice work. Load `/wiki` for knowledge-layer work.
The skills define all available commands. This block enforces the contract, not the command surface.

Agent surface (3 commands): `wiki forge plan wiki-forge <feature-name>`, `wiki forge run wiki-forge [slice-id] --repo <path>`, `wiki forge next wiki-forge`
Session start: `wiki resume wiki-forge --repo <path> --base <rev>`

<!-- wiki-forge:orientation:end -->

# CLAUDE

## Required workflow

Load `/forge` for the full workflow. Load `/wiki` for knowledge-layer work.

Decision rule:
- changing runtime/product behavior → `/forge`
- researching, retrieving, documenting, verifying → `/wiki`
- research as part of a larger feature/refactor/perf effort → `/forge` (research as phase 1)

Do not silently skip missing skills. If a required skill is unavailable, say so explicitly.

## Default project setup

When using an external vault:

```bash
export KNOWLEDGE_VAULT_ROOT=~/Knowledge
```

## Notes

- `wiki` is globally available on PATH.
- `AGENTS.md` is sync-managed from the same wiki orientation source as `CLAUDE.md`; do not treat them as separate workflow policies.
