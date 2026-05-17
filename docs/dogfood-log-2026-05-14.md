# Dogfood Log — 2026-05-14

Scope: exercised the refreshed grill-with-docs and Forge planning workflow against an isolated temp vault.

## Commands exercised

- `wiki scaffold-project dogfood`
- `wiki forge grill record dogfood --context-file ... --decision-title ... --decision-file ... --tag PRD-001 --tag DOGFOOD-001 --json`
- `wiki forge plan dogfood "workflow dogfood" --torpathy-answer-file ... --json`
- `wiki forge plan dogfood "workflow dogfood" --grill-with-docs-answer-file ... --json`
- `wiki forge plan dogfood "workflow dogfood" --prd ... --json`
- `wiki forge plan dogfood "workflow dogfood" --prd ... --prd-grill-answer-file ... --json`
- `wiki forge plan dogfood "workflow dogfood" --prd ... --slice ... --json`
- `wiki forge plan dogfood "workflow dogfood" --complete-session --json`
- `wiki forge plan dogfood "workflow dogfood" --create-artifacts --json`
- `wiki forge status dogfood DOGFOOD-001 --json`
- `wiki forge next dogfood --json`
- `wiki forge start dogfood DOGFOOD-001 --agent dogfood --json`
- `wiki forge tdd red/green ... --json`
- `wiki forge evidence dogfood DOGFOOD-001 verify ... --json`
- `wiki forge review record dogfood DOGFOOD-001 ... --json`
- `wiki forge run dogfood DOGFOOD-001 --json`
- `wiki handover dogfood ... --json`
- `wiki resume dogfood --json`
- `wiki ask dogfood "where do grill decisions live?" --bm25 --json`
- `wiki qmd-status`

## Passed seams

- `wiki forge grill record` created `projects/dogfood/architecture/domain-language.md` and appended `ADR-0001` to `projects/dogfood/decisions.md`.
- Grill decision refs included PRD/slice tags and matched Forge decision-ref detection.
- File-based planning answers worked for torpathy, grill-with-docs, and PRD grill steps.
- Planning session completed and created Forge-owned feature, PRD, and slice records.
- TDD red/green evidence, targeted verification, review evidence, and close all recorded successfully.
- Handover wrote a typed Forge handover and `wiki resume` loaded the latest handover.

## Broken or confusing seams logged as tasks

- #11: Missing `KNOWLEDGE_VAULT_ROOT` path aborts before `wiki scaffold-project` can create a vault or give a recovery command.
- #12: `wiki forge next` says draft slices must be released first, but `wiki forge start` accepted the draft slice anyway.
- #13: QMD retrieval/status ignored the temp `KNOWLEDGE_VAULT_ROOT` and used the real `~/Knowledge` index.
- #14: `wiki ask --json` returned plain text instead of JSON.
- #15: After closing the only slice, `wiki resume` reports `status: empty` / `plan-next-slice`, which is technically plausible but confusing without closed-slice context.

## Temp vault

Last run vault: `/tmp/wiki-forge-dogfood-vault-39871`.
