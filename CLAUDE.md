---
managed_by: wiki-forge
protocol_version: 2
project: wiki-forge
scope: root
applies_to: .
---
<!-- wiki-forge:agent-protocol:start -->
# Agent Protocol

> Managed by wiki-forge. Keep local repo-specific notes below the managed block.
> `AGENTS.md` and `CLAUDE.md` carry the same sync-managed protocol block. Do not treat them as separate policy sources.

Scope: repo root

Use `/forge` for non-trivial implementation work.
Use `/wiki` for retrieval, refresh, drift, verification, and closeout review.
If slash-skill aliases are unavailable, run the equivalent `wiki` CLI lifecycle directly.
`wiki protocol sync` only syncs this managed block; it does not enforce behavior or sync skill policy.

## Code Quality

Codex (GPT-5-class reviewer) reviews every change before it merges. Write as if a stricter reviewer is watching:
- Smaller, more focused diffs. Every changed line should trace to the task.
- Honest names. No `foo`, no `handleStuff`, no vague `utils`.
- Tight types. No `any`, no unchecked casts, no silent `as unknown as T`.
- Real error handling. No bare `catch {}`, no swallowed promises, no `throw new Error("TODO")`.
- Tests that describe behavior, not implementation. Delete shallow tests you replace.
- Match the surrounding style even when you'd design differently.

Sloppy code costs a review round-trip. Writing it right the first time is faster than arguing with a reviewer.

## Workflow Enforcement

Load `/forge` for tracked slice work. Load `/wiki` for knowledge-layer work.
The skills define all available commands. This block enforces the contract, not the command surface.

Agent surface (3 commands): `wiki forge plan wiki-forge <feature-name>`, `wiki forge run wiki-forge [slice-id] --repo <path>`, `wiki forge next wiki-forge`
Session start: `wiki resume wiki-forge --repo <path> --base <rev>`

<!-- wiki-forge:agent-protocol:end -->

# CLAUDE

## Required workflow

Load `/forge` for the full workflow. Load `/wiki` for knowledge-layer work.

Decision rule:
- changing runtime/product behavior -> `/forge`
- researching, retrieving, documenting, or verifying without active product changes -> `/wiki`
- research as part of a larger feature/refactor/perf effort -> `/forge` (with research as phase 1)

Do not silently skip missing skills. If a required skill is unavailable, say so explicitly.

## Default project setup

When using an external vault:

```bash
export KNOWLEDGE_VAULT_ROOT=~/Knowledge
```

## Notes

- `wiki` is globally available on PATH.
- `AGENTS.md` is sync-managed from the same protocol source as `CLAUDE.md`; do not treat them as separate workflow policies.
