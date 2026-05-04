---
name: tdd
description: >
  Test-driven development with a strict red-green-refactor loop, integrated with the wiki slice lifecycle. Use when building features, fixing bugs, implementing slices, or doing behavior-preserving refactors through characterization tests.
---

# Test-Driven Development

TDD turns planned or existing behavior into verified implementation through red-green-refactor loops.

Tests must describe observable behavior through public interfaces. Avoid implementation-coupled tests, private-method checks, and mocks of code you own.

For new behavior or bug fixes, start with a failing behavior test that demonstrates the desired outcome.

For behavior-preserving refactors, first capture current externally visible behavior with characterization tests through public interfaces, then use those tests to drive safe refactoring. Characterization is for preserving and understanding current behavior, not for skipping the red phase when changing behavior or adding capability.

## Loop

1. Read the slice `plan.md`, `test-plan.md`, and current Forge steering packet.
2. If the packet requires subagent-vs-linear evaluation, record the subagent-vs-linear decision with conflict rationale before implementation edits, covering file ownership, shared state/migration risk, coordination cost, and hidden context/artifact handoff risk.
3. Pick one behavior.
4. Write one failing test for the next change. If refactoring existing behavior, write or extend a characterization test that demonstrates the current behavior first, then make the next change in small verified steps.
5. Implement the smallest code change that passes the current test.
6. Refactor only while green.
7. Repeat until the slice acceptance criteria are covered.
8. Run the verification commands from the test plan.
9. Record TDD and targeted verification evidence, then return to `wiki forge run <project> <slice> --repo <path>` for check/review/close orchestration.

## Commands

- Inspect workflow: `wiki forge status <project> <slice> --repo <path>`
- Record TDD red: `wiki forge tdd red <project> <slice> --test <path> --command "<failing command>" --note "<why this fails>"`
- Record TDD green: `wiki forge tdd green <project> <slice> --test <same path> --command "<same command>" --note "<what now passes>"`
- Record targeted verification: `wiki forge evidence <project> <slice> verify --command "<targeted command>" --repo <path>`
- Continue/close tracked work: `wiki forge run <project> <slice> --repo <path>`
- Do not use removed legacy commands. Record verification with `wiki forge evidence`, then continue with `wiki forge run`.
- Full command details: `wiki help` or `wiki help --all`

## Rules

No code without a behavior test. When a behavior is only provable through broader verification, record that behavior evidence explicitly.

Do not batch all tests first and all implementation second. Use tracer bullets: one red test, one green implementation, then refactor.

Red and green evidence must use the exact same command string. The green record must reuse the exact same `--command` string as red and at least one same `--test` path. If you change the command while fixing the test, record a new red first; otherwise Forge will reject close evidence as an invalid TDD pair.

Do not use characterization as a bypass for implementation work: when changing behavior, add a failing test for the new outcome before making the code pass.

After editing repo skill files, run `bun run sync:full` for the full workflow install or `bun run sync:wiki` for wiki-only, optionally audit with `bun run sync:local -- --audit`, then restart the agent session.
