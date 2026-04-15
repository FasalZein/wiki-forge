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

If the user points to a GitHub issue or external doc and there is no vault PRD yet, stop this skill and route back to `/forge`:
1. `/research`
2. `/grill-me`
3. `/write-a-prd`
4. return to `/prd-to-slices` only after the PRD exists in the vault

This skill decomposes an approved PRD. It does not replace the earlier forge steps.

### 2. Explore the codebase

If you have not already explored the codebase, do so. Understand what exists before slicing.

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
- **Blocked by**: which other slices must complete first
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
wiki create-issue-slice <project> <title> [--priority p0|p1|p2] [--tag <tag>] [--prd <PRD-ID>]
```

This creates four things per slice:
1. A backlog task in `backlog.md` with a unique ID (e.g., `PROJECT-003`)
2. A task hub at `specs/slices/<ID>/index.md`
3. An implementation plan at `specs/slices/<ID>/plan.md`
4. A test plan at `specs/slices/<ID>/test-plan.md`

Create slices in dependency order (blockers first) so you can reference task IDs in later plans.

### 6. Fill in the plans

After scaffolding, immediately run `wiki start-slice <project> <slice-id> --agent <name> --repo <path>` for the selected slice, then fill in each plan before starting code. Do not start implementation against an empty slice scaffold.

**Implementation plan** (`specs/slices/<ID>/plan.md`):
- Scope: what this slice covers end-to-end
- Vertical Slice: numbered steps through each layer
- Acceptance Criteria: checkboxes matching PRD stories
- Add `Blocked by: PROJECT-001` if dependencies exist

**Test plan** (`specs/slices/<ID>/test-plan.md`):
- Red Tests: the failing tests to write first
- Green Criteria: what "passing" means
- Refactor Checks: what to clean up after green

Only after the slice is in progress and both docs are filled should `/tdd` begin.

### 7. Continuation rule

If the user says "proceed", "continue", or otherwise asks for the next implementation step after a completed non-trivial slice, do not continue coding ad hoc.

First:
1. select the existing slice still in progress, or
2. create the next slice under the current PRD

Then fill its plan + test plan and resume with `/tdd`.

Reuse the existing PRD when the scope still fits it. Only create or rewrite a PRD when the scope materially changes.

### 8. Link back to PRD

Pass `--prd <PRD-ID>` when creating each slice so lineage stays mechanical.
That writes `parent_prd` / `parent_feature` metadata onto the slice docs, which `wiki update-index <project> --write` uses to regenerate parent/child planning sections.

The generated task hub and plans already link back to the PRD:
```markdown
- [[projects/<project>/specs/prds/PRD-<nnn>-<slug>]]
```

Do not hand-maintain PRD child-slice lists; let `update-index` regenerate them.

### 9. Verify slicing artifacts, then hand off to implementation

After creating and filling all slices, run the planning-doc closeout sequence:

```bash
wiki update-index <project> --write
wiki lint <project>
wiki lint-semantic <project>
```

At this point the slice docs are planned, not implemented. Do **not** mark them `code-verified` from memory before `/tdd` produces code and tests.

After implementation, use the canonical `/wiki` closeout lifecycle instead of an ad hoc subset:
- run `wiki checkpoint <project> --repo <path>`
- run `wiki lint-repo <project> --repo <path>`
- run `wiki maintain <project> --repo <path> --base <rev>`
- update impacted pages from code/tests
- run `wiki update-index <project> --write` if navigation or planning links changed
- run `wiki verify-page ...`
- run `wiki verify-slice <project> <slice-id> --repo <path>`
- run `wiki closeout <project> --repo <path> --base <rev>`
- run `wiki gate <project> --repo <path> --base <rev>`
- run `wiki close-slice <project> <slice-id> --repo <path> --base <rev>`

Status discipline:
- create slice
- start it with `wiki start-slice`
- implement with `/tdd`
- run the full `/wiki` closeout lifecycle after code/tests exist
- close it with `wiki close-slice`

## When to use GitHub Issues instead

Use `prd-to-issues` (the GitHub variant) only when:
- External collaborators need visibility into the breakdown
- Your project management lives in GitHub Projects
- You need cross-repo issue references

For solo or agent-driven work, wiki slices are faster and more token-efficient.
