---
name: prd-to-slices
description: >
  Break a PRD into tracer-bullet vertical slices stored in the wiki backlog.
  Use when converting a PRD to implementation slices, creating work items,
  or breaking down a feature into independently-grabbable tasks.
---

# PRD to Slices

Break a PRD into independently-grabbable vertical slices. Each slice gets a backlog task, implementation plan, and test plan — all in the wiki, zero API calls.

## Process

### 1. Locate the PRD

The PRD should already exist in the wiki at `projects/<project>/specs/prds/PRD-*.md`.

If the user points to a GitHub issue or external doc and there is no vault PRD yet, stop this skill and route back to `/forge` — the PRD must exist before slicing can begin. See forge SKILL.md for the full pipeline.

This skill decomposes an approved PRD. It does not replace the earlier forge steps.

### 2. Explore the codebase

If you have not already explored the codebase, do so. Understand what exists before slicing:
- Read modules that will be modified
- Understand existing interfaces and test patterns
- Identify natural vertical boundaries

### 3. Draft vertical slices

Break the PRD into **tracer bullet** slices. Each slice is a thin vertical cut through ALL layers end-to-end — NOT a horizontal layer ticket.

Rules:
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Each slice must be testable in isolation

Slices are either:
- **AFK** — can be implemented and verified without human input (prefer this)
- **HITL** — requires a human decision, design review, or external dependency

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice show:

- **Title**: short descriptive name
- **Type**: AFK / HITL
- **Blocked by**: which other slices must complete first (`depends_on` in frontmatter)
- **User stories covered**: which stories from the PRD this addresses
- **Test approach**: what the red tests will verify

Ask:
- Does the granularity feel right?
- Are dependency relationships correct?
- Should any slices be merged or split?
- Are AFK/HITL assignments correct?

Iterate until the user approves when a human is available.
If human approval is unavailable, proceed with AFK slices only, keep HITL slices blocked, and record the unresolved decision explicitly in the generated slice docs.

### 5. Create wiki slices

For each approved slice, run:

```bash
wiki create-issue-slice <project> <title> [--priority p0|p1|p2] [--tag <tag>] [--prd <PRD-ID>] [--assignee <agent>] [--source <path...>]
```

**Always pass `--prd <PRD-ID>`** so lineage stays mechanical. This writes `parent_prd` and `parent_feature` metadata onto slice docs. `--source` overrides inherited parent PRD bindings when the slice touches a narrower set of files.

This creates four things per slice:
1. A backlog task in `backlog.md` with a unique ID (e.g., `PROJECT-003`)
2. A task hub at `specs/slices/<ID>/index.md`
3. An implementation plan at `specs/slices/<ID>/plan.md`
4. A test plan at `specs/slices/<ID>/test-plan.md`

Create slices in dependency order (blockers first) so you can reference task IDs in later plans. Add `depends_on: [TASK-ID]` to slice frontmatter when ordering matters.

### 6. Fill in the plans

After scaffolding, use `wiki forge plan` (which auto-starts the slice) or `wiki forge run` (which auto-starts if needed). This:
- Checks `depends_on` ordering
- Moves the backlog item to In Progress
- Auto-opens parent PRD and feature if they are still `not-started`
- Prints a compact plan summary

Then fill in each plan before starting code. Do not start implementation against an empty slice scaffold.

**Implementation plan** (`specs/slices/<ID>/plan.md`):
- Scope: what this slice covers end-to-end
- Vertical Slice: numbered steps through each layer
- Acceptance Criteria: checkboxes matching PRD stories

**Test plan** (`specs/slices/<ID>/test-plan.md`):
- Red Tests: the failing tests to write first
- Green Criteria: what "passing" means
- Refactor Checks: what to clean up after green
- Verification Commands: shell commands that prove the slice is done (used by `wiki verify-slice`)

Only after the slice is in progress and both docs are filled should `/tdd` begin.

### 7. Continuation rule

If the user says "proceed", "continue", or otherwise asks for the next implementation step after a completed non-trivial slice, do not continue coding ad hoc.

First:
1. select the existing slice still in progress, or
2. create the next slice under the current PRD

Then fill its plan + test plan and resume with `/tdd`.

Reuse the existing PRD when the scope still fits it. Only create or rewrite a PRD when the scope materially changes.

### 8. Hierarchy auto-triggers

The wiki CLI manages feature/PRD lifecycle automatically:
- `wiki start-slice` auto-opens parent PRD and feature (`not-started` -> `in-progress`)
- `wiki close-slice` auto-closes parent PRD and feature when all children are complete
- `wiki feature-status <project>` shows the computed hierarchy at any time

You don't need to manually run `start-feature`/`start-prd` when starting slices — the auto-triggers handle it. Use `wiki feature-status` to verify the hierarchy looks correct after slicing.

### 9. Verify slicing artifacts

After creating and filling all slices, run:

```bash
wiki update-index <project> --write
wiki lint <project>
wiki lint-semantic <project>
```

`lint-semantic` will flag orphaned slices (missing `parent_prd`) — this is why `--prd` is important.

At this point the slice docs are planned, not implemented. Do **not** mark them `code-verified` from memory before `/tdd` produces code and tests.

### 10. Hand off to implementation

Slicing sits after PRD approval and before TDD. Successor: `/tdd`. See forge SKILL.md for the full pipeline.

After verification, the slices are ready for `/tdd`. Fill plan + test-plan, then run `/tdd`, then `wiki forge run`.

## When to use GitHub Issues instead

Use `prd-to-issues` (the GitHub variant) only when:
- External collaborators need visibility into the breakdown
- Your project management lives in GitHub Projects
- You need cross-repo issue references

For solo or agent-driven work, wiki slices are faster and more token-efficient.

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:local`.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
