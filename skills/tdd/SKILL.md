---
name: tdd
description: >
  Test-driven development with red-green-refactor loop, integrated with the wiki slice lifecycle. Use when building features, fixing bugs, or implementing slices using TDD.
---

# Test-Driven Development

TDD turns a planned behavior into verified implementation through red-green-refactor loops.

Tests must describe observable behavior through public interfaces. Avoid implementation-coupled tests, private-method checks, and mocks of code you own.

## Loop

1. Read the slice `plan.md` and `test-plan.md`.
2. Pick one behavior.
3. Write one failing test.
4. Implement the smallest code change that passes it.
5. Refactor only while green.
6. Repeat until the slice acceptance criteria are covered.
7. Run the verification commands from the test plan.
8. Return to `wiki forge run <project> <slice> --repo <path>` for verify, desloppify, review, closeout, and gate.

## Commands

- Inspect workflow: `wiki forge status <project> <slice> --repo <path>`
- Run slice verification: `wiki verify-slice <project> <slice> --repo <path>`
- Continue/close tracked work: `wiki forge run <project> <slice> --repo <path>`
- Full command details: `wiki help` or `wiki help --all`

## Rules

No code without a behavior test. No exceptions.

Do not batch all tests first and all implementation second. Use tracer bullets: one red test, one green implementation, then refactor.

After editing repo skill files, run `bun run sync:local` and `bun run sync:local -- --audit`.
