# Desloppify Complexity Triage

Current score: 98/100 after WIKI-FORGE-302 safe mechanical cleanup and WIKI-FORGE-303 triage documentation.

## Remaining finding

- Rule: `LONG_FILE`
- File: `src/forge/workflow/commands.ts`
- Why it remains: the file is over the scanner threshold, but it is also the current command adapter seam for Forge workflow commands. Splitting it blindly can create worse navigation and lifecycle-risk than the remaining one-point score penalty.

## Decision

Do not split this file solely to satisfy the metric.

A future extraction should happen only as a dedicated Forge slice with a concrete boundary, such as:

- TDD command parsing/rendering helpers;
- evidence/review command adapters;
- start/release/amend command adapters;
- shared flag parsing helpers.

## Follow-up requirements

Create a dedicated Forge slice before extracting command groups. The slice must name the command group being moved and prove behavior through public CLI tests.

Targeted tests must cover every moved command adapter. At minimum, run the affected `tests/forge-kernel/cli-forge-*.test.ts` files plus `bun run check` and a follow-up `bunx desloppify score . --pack js-ts`.

Keep the current score target at `>= 90`; the repo already exceeds that bar. The next complexity refactor should optimize readability and command ownership, not just the numeric score.
