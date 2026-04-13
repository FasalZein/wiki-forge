# AGENTS

## Required workflow

This repo uses a skill-driven workflow. Load `/forge` for the full policy.

Use `/forge` for non-trivial implementation workflow: research → PRD → slices → TDD → wiki verification.
Use `/wiki` for knowledge-layer work: research filing/audit, retrieval, refresh, drift, verification, and closeout once implementation choices are already made.

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
- Run `wiki gate <project> --repo <path> --base <rev>` before declaring a slice complete.
- File research with `wiki research file` before writing PRDs.
- Update impacted wiki pages from code and tests, not from memory.
- Do not accept unmaintainable code as the cost of speed.

## Default completion flow

After implementation:
1. run tests
2. `wiki refresh-from-git <project> --repo <path> --base <rev>`
3. `wiki drift-check <project> --show-unbound`
4. update impacted wiki pages
5. `wiki verify-page <project> <page> code-verified` or `test-verified`
6. `wiki lint <project>`
7. `wiki lint-semantic <project>`
8. `wiki gate <project> --repo <path> --base <rev>`

## Default project setup

When using an external vault:

```bash
export KNOWLEDGE_VAULT_ROOT=~/Knowledge
```

## Notes

- `wiki` is globally available on PATH.
- Skills: `forge` (policy), `wiki` (operations), `prd-to-slices` (decomposition), plus `grill-me`, `write-a-prd`, and `tdd` for forge chaining, at `~/.agents/skills/`.
- Harness decision rule: assume a skill-capable harness can use both `/wiki` and `/forge`; choose based on task scope, not capability.
- Use `wiki maintain` as the default agent entry point for maintenance work.
- When editing vault markdown, prefer Obsidian-flavored notes: properties, wikilinks, embeds, and callouts. Load `obsidian-markdown` for note-authoring rules.
