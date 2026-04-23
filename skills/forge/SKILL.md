---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the delivery workflow layer for tracked implementation work.

Use it when changing runtime/product behavior, continuing a slice, or closing verified work. The CLI owns phase ordering and recovery; do not treat this skill body as the source of workflow truth.

## Commands

- Start or resume: `wiki resume <project> --repo <path> --base <rev>`
- Pick work: `wiki forge next <project>`
- Inspect a slice: `wiki forge status <project> <slice> --repo <path>`
- Plan work: `wiki forge plan <project> <feature-name>`
- Run work: `wiki forge run <project> [slice-id] --repo <path>`
- Waive a skippable phase: `wiki forge skip <project> <slice> <phase> --reason <text>`

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`. It includes the current phase, required skill, iteration contract, quality gates, and review gates.

Normal chain: `wiki research -> /domain-model` (+ `/torpathy` when design pressure is flagged) `-> /write-a-prd -> /prd-to-slices -> /tdd -> /desloppify`.

`tdd` and `verify` are not skippable. Research, domain-model, PRD, and slices may be skipped only with an audited `wiki forge skip` reason.

For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After editing repo skill files, run:

```bash
bun run sync:local
bun run sync:local -- --audit
```
