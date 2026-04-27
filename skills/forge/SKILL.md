---
name: forge
description: >
  Build with rigor. Consumes wiki research, then drives code-owned workflow enforcement through domain-model, PRD, slices, TDD, verification, desloppify, and review gates. Use for tracked implementation work.
---

# Forge

Forge is the delivery workflow layer for tracked implementation work.

Use it when changing runtime/product behavior, continuing a slice, or closing verified work. The CLI owns phase ordering and recovery; do not treat this skill body as the source of workflow truth.

## Commands

- Start or resume context: `wiki resume <project> --repo <path> --base <rev>`
- Pick work: `wiki forge next <project>`
- Inspect workflow truth: `wiki forge status <project> <slice> --repo <path>`
- Inspect workflow truth in machine-readable form: `wiki forge status <project> <slice> --json`
- Refresh freshness truth before closeout or after drift suspicion: `wiki checkpoint`
- Repair stale state, closeout debt, or verify-loop conditions: `wiki maintain`
- Reconnect research when implementation needs fresh evidence: `wiki research bridge`
- Plan work: `wiki forge plan <project> <feature-name>`
- Run work: `wiki forge run <project> [slice-id] --repo <path>`
- Create a follow-up for closed work without reopening it: `wiki forge amend <project> <closed-slice-id> --reason <text>`
- Waive a skippable phase: `wiki forge skip <project> <slice> <phase> --reason <text>`

## Contract

Follow the steering packet from `wiki resume`, `wiki forge next`, or `wiki forge status`. It includes the current phase, required skill, iteration contract, subagent policy, quality gates, and review gates.

Normal chain: `wiki research -> /domain-model` (+ `/torpathy` when design pressure is flagged) `-> /write-a-prd -> /prd-to-slices -> /tdd -> /desloppify`.

After planning, obey the runtime subagent policy: evaluate subagent-driven vs linear implementation before TDD edits, choose linear when subagents would create conflicts, and use the required reviewer subagents before closeout.

`tdd` and `verify` are not skippable. Research, domain-model, PRD, and slices may be skipped only with an audited `wiki forge skip` reason.

When verify or closeout fails, do not assume a generic forge rerun is correct. Use `wiki forge status <project> <slice> --json` as workflow truth, `wiki checkpoint` as freshness truth, and `wiki maintain` as the explicit repair path for stale-page closeout noise, checkpoint debt, or repeated verify loops. Use `wiki resume` for context only, not as proof that freshness or repair work is complete.

If evidence or implementation context has drifted, use `wiki research bridge` before continuing delivery work.

For full details, run `wiki help` or `wiki help --all`.

## Skill edits

After applying repo skill file changes, run:

```bash
bun run sync:local
bun run sync:local -- --audit
```

Then restart the agent session.
