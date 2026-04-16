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

## Wiki Protocol

Before starting slice work:
- `wiki start-slice wiki-forge <slice-id> --agent <name> --repo <path>`

During work:
- `wiki checkpoint wiki-forge --repo <path>`
- `wiki lint-repo wiki-forge --repo <path>`

Before completion:
- `wiki maintain wiki-forge --repo <path> --base <rev>`
- update impacted wiki pages from code and tests
- `wiki verify-page wiki-forge <page...> <level>`
- `wiki verify-slice wiki-forge <slice-id> --repo <path>`
- `wiki closeout wiki-forge --repo <path> --base <rev>`
- `wiki gate wiki-forge --repo <path> --base <rev>`
- `wiki close-slice wiki-forge <slice-id> --repo <path> --base <rev>`

<!-- wiki-forge:agent-protocol:end -->

# AGENTS

## Required workflow

This repo uses a skill-driven workflow. Load `/forge` for the full policy.

Use `/forge` for non-trivial implementation workflow: research → PRD → slices → TDD → wiki verification.
Use `/wiki` for knowledge-layer work: research filing/audit, retrieval, refresh, drift, verification, and closeout once implementation choices are already made.
Both skills drive the same `wiki` CLI; `/forge` is the workflow layer, `/wiki` is the knowledge/verification layer.
If a harness does not support slash-skill aliases, run the equivalent `wiki` CLI lifecycle directly.
`CLAUDE.md` is sync-managed from the same protocol source as `AGENTS.md`; do not treat them as separate workflow policies.

For non-trivial work:
1. use `research`
2. use `grill-me`
3. use `write-a-prd`
4. use `prd-to-slices`
5. use `tdd`
6. use `wiki`

For small tasks, do not trigger forge by default. Use the smallest fitting workflow instead:
- tiny bug fix / focused refactor: `tdd` + `wiki`
- docs/wiki formatting only: `wiki` + `obsidian-markdown`
- repo exploration / understanding: `wiki` only

Decision rule:
- changing runtime/product behavior -> `forge`
- researching, retrieving, documenting, or verifying without active product changes -> `wiki`
- research as part of a larger feature/refactor/perf effort -> `forge` (with research as phase 1)

Do not silently skip missing skills. If a required skill is unavailable, say so explicitly.

## Hard gates

- No production code change is complete without changed tests or a documented exception in the wiki.
- Run `wiki gate <project> --repo <path> --base <rev>` before declaring a slice complete. Treat it as necessary, not sufficient.
- File research with `wiki research file` before writing PRDs.
- Update impacted wiki pages from code and tests, not from memory.
- Do not accept unmaintainable code as the cost of speed.
- `wiki closeout` is a review surface, not a repair step.
- `wiki close-slice` is the final state transition after verification work; it does not replace `maintain`, `verify-page`, or `gate`.

## Default completion flow

For active slice work, use one canonical order:
1. `wiki start-slice <project> <slice-id> --agent <name> --repo <path>`
2. fill `plan.md` and `test-plan.md`
3. implement with tests
4. `wiki checkpoint <project> --repo <path>`
5. `wiki lint-repo <project> --repo <path>`
6. `wiki maintain <project> --repo <path> --base <rev>`
7. update impacted wiki pages from code and tests
8. `wiki update-index <project> --write` if navigation/planning links changed
9. `wiki verify-page <project> <page...> <level>`
10. `wiki verify-slice <project> <slice-id> --repo <path>`
11. `wiki closeout <project> --repo <path> --base <rev>`
12. `wiki gate <project> --repo <path> --base <rev>`
13. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>`

## Default project setup

When using an external vault:

```bash
export KNOWLEDGE_VAULT_ROOT=~/Knowledge
```

## Notes

- `wiki` is globally available on PATH.
- Repo agent instructions should be installed/synced with `wiki protocol sync <project> --repo <path>`; the managed top block in repo `AGENTS.md` / `CLAUDE.md` is not hand-maintained.
- Skills: `forge` (policy), `wiki` (operations), `prd-to-slices` (decomposition), plus `grill-me`, `write-a-prd`, and `tdd` for forge chaining, at `~/.agents/skills/`.
- Harness decision rule: assume a skill-capable harness can use both `/wiki` and `/forge`; choose based on task scope, not capability.
- Use `wiki maintain` as the default agent entry point for maintenance work.
- `wiki protocol sync` keeps repo instruction files aligned, but it does not sync or enforce skill policy; keep the repo-local skills aligned separately.
- When editing vault markdown, prefer Obsidian-flavored notes: properties, wikilinks, embeds, and callouts. Load `obsidian-markdown` for note-authoring rules.
