---
name: prd-to-slices
description: >
  Break a PRD into tracer-bullet vertical slices for Forge-owned planning.
  Use when converting a PRD to implementation slices, creating work items,
  or breaking down a feature into independently-grabbable tasks.
---

# PRD to Slices

Break a PRD into independently-grabbable vertical slices. Each slice is a thin vertical cut through all layers end-to-end, not a horizontal layer ticket.

This skill is a decomposition aid. In wiki-managed projects, the canonical command that creates or resumes feature/PRD/slice artifacts is:

```bash
wiki forge plan <project> <feature-name> --repo <path>
```

Do not use removed legacy lifecycle commands such as `wiki create-issue-slice`, `wiki start-slice`, `wiki close-slice`, `wiki claim`, or `wiki pipeline`.

## Process

### 1. Locate the PRD or planning session

Prefer the Forge planning packet/session created by `wiki forge plan`. If the user points to a PRD, external document, or issue and there is no Forge planning session yet, route through `/forge` and `wiki forge plan` first.

This skill decomposes approved scope. It does not replace research, domain modeling, PRD/spec writing, or Forge's planning gate.

### 2. Explore the codebase

Understand what exists before slicing:

- read modules that will be modified
- understand existing interfaces and test patterns
- identify natural vertical boundaries
- identify files or artifacts that must not be owned by multiple parallel agents

### 3. Draft vertical slices

Rules:

- Each slice delivers a narrow but complete path through every affected layer.
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Each slice must be testable in isolation.
- Each slice needs a clear ownership boundary so implementation can be linear or safely parallelized.

Slices are either:

- **AFK** — can be implemented and verified without human input.
- **HITL** — requires a human decision, design review, or external dependency.

### 4. Quiz the user when available

Present the proposed breakdown as a numbered list. For each slice show:

- **Title**: short descriptive name
- **Type**: AFK / HITL
- **Blocked by**: which slices must complete first
- **User stories covered**: which stories from the PRD this addresses
- **Test approach**: what the red tests will verify
- **Ownership boundary**: files/modules/artifacts expected to be touched

Ask whether the granularity, dependency relationships, and AFK/HITL assignments are correct.

If human approval is unavailable, proceed with AFK slices only, keep HITL slices blocked, and record unresolved decisions explicitly in the planning output.

### 5. Create or update slices through Forge

Use Forge planning, not legacy task/scaffold commands:

```bash
wiki forge plan <project> <feature-name> --repo <path>
```

When continuing an existing plan, follow the packet's prompt and answer the remaining planning questions until Forge reports the planning session can create or update feature, PRD/spec, and slice records.

Forge-owned artifacts live under the project's Forge layout, not the old specs-backed lifecycle surface. Treat `backlog.md` and generated hierarchy views as projections/admin views only.

### 6. Fill slice plans and test plans

Before implementation begins, each slice should have:

**Implementation plan**

- Scope: what this slice covers end-to-end
- Vertical Slice: numbered steps through each layer
- Acceptance Criteria: checkboxes matching PRD stories
- Ownership: files/modules/artifacts likely touched

**Test plan**

- Red Tests: failing tests to write first
- Green Criteria: what passing means
- Refactor Checks: what to clean up after green
- Verification Commands: targeted commands that prove this slice is done

Only after the slice is ready and both docs are filled should `/tdd` begin.

### 7. Continuation rule

If the user says "proceed", "continue", or otherwise asks for the next implementation step after a completed non-trivial slice, do not continue coding ad hoc.

First:

1. inspect `wiki forge next <project> --repo <path>` or `wiki forge status <project> [slice-id] --repo <path>`
2. select the existing active/ready slice, or
3. return to `wiki forge plan` if the scope needs new slices

Then resume with `/tdd` and close through `wiki forge run`.

### 8. Hierarchy and read models

Old hierarchy commands are not lifecycle authority. Do not use:

```text
wiki start-slice
wiki close-slice
wiki claim
wiki verify-slice
wiki create-issue-slice
wiki backlog/add-task/move-task/complete-task
```

Use:

```bash
wiki forge status <project> [slice-id] --repo <path>
wiki forge run <project> [slice-id] --repo <path>
wiki checkpoint <project> --repo <path> --base <rev>
wiki maintain <project> --repo <path> --base <rev>
```

Forge status is workflow truth. Checkpoint/maintain are freshness and repair truth. Generated views are projections.

### 9. Hand off to implementation

Slicing sits after PRD/spec approval and before TDD. Successor: `/tdd`. See `skills/forge/SKILL.md` for the full chain.

After slices are planned, fill plan + test-plan, then run `/tdd`, record evidence, review, and close through `wiki forge run`.

## When to use GitHub Issues instead

Use `prd-to-issues` only when external collaborators need issue visibility or your project management lives in GitHub Projects. For solo or agent-driven wiki-forge work, Forge planning is the source of truth.

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:local`.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
