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

The PRD should be in the wiki at `projects/<project>/specs/prd-*.md`.

If the user points to a GitHub issue or external doc, read it first, then file it with `wiki create-prd <project> <name>` so it lives in the vault.

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

Iterate until the user approves.

### 5. Create wiki slices

For each approved slice, run:

```bash
wiki create-issue-slice <project> <title> [--priority p0|p1|p2] [--tag <tag>]
```

This creates four things per slice:
1. A backlog task in `backlog.md` with a unique ID (e.g., `PROJECT-003`)
2. A task hub at `specs/<ID>/index.md`
3. An implementation plan at `specs/<ID>/plan.md`
4. A test plan at `specs/<ID>/test-plan.md`

Create slices in dependency order (blockers first) so you can reference task IDs in later plans.

### 6. Fill in the plans

After scaffolding, fill in each plan:

**Implementation plan** (`specs/<ID>/plan.md`):
- Scope: what this slice covers end-to-end
- Vertical Slice: numbered steps through each layer
- Acceptance Criteria: checkboxes matching PRD stories
- Add `Blocked by: PROJECT-001` if dependencies exist

**Test plan** (`specs/<ID>/test-plan.md`):
- Red Tests: the failing tests to write first
- Green Criteria: what "passing" means
- Refactor Checks: what to clean up after green

### 7. Link back to PRD

Add wikilinks from the task hub and plans back to the PRD:
```markdown
- [[projects/<project>/specs/prd-<name>]]
```

And update the PRD's Cross Links to reference the slice hub.

### 8. Verify and close out

After creating and filling all slices, run the closeout sequence:

```bash
wiki update-index <project> --write
wiki lint <project>
wiki lint-semantic <project>
wiki verify-page <project> <page...> code-verified   # for each new slice page
wiki gate <project> --repo <path> --base <rev>
```

Do not declare slicing complete until `lint`, `lint-semantic`, and `gate` all pass. If `gate` fails, fix the reported issues before moving on.

## When to use GitHub Issues instead

Use `prd-to-issues` (the GitHub variant) only when:
- External collaborators need visibility into the breakdown
- Your project management lives in GitHub Projects
- You need cross-repo issue references

For solo or agent-driven work, wiki slices are faster and more token-efficient.
