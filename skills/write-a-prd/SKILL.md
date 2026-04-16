---
name: write-a-prd
description: >
  Create a PRD through user interview, codebase exploration, and module design, then file it in the wiki vault.
  Use when user wants to write a PRD, create a product requirements document, or plan a new feature.
---

# Write a PRD

Create a PRD in the wiki vault under `projects/<project>/specs/prds/`. Skip steps when context already covers them.

## Prerequisites

1. A feature must exist — every PRD requires `--feature <FEAT-ID>`. Create one with `wiki create-feature <project> <name>` if needed.
2. Research should be filed — the PRD links to it in Prior Research. File with `wiki research file <project> <title>` after using `/research`.

If no feature exists, create one first. If no research exists, route to `/research` before proceeding.

## Process

### 1. Gather problem context

Ask the user for a detailed description of:
- The problem they want to solve and who is affected
- Constraints, deadlines, or dependencies
- Any solution ideas or prior art

### 2. Explore the codebase

Read relevant source code to verify assertions and understand what exists. Don't write a PRD from memory — code is the source of truth. Focus on:
- Existing modules that will be modified
- Interfaces that constrain the design
- Test patterns already in place
- Related features or prior work

### 3. Interview the user

Interview relentlessly about every aspect of the plan until you reach shared understanding. Walk each branch of the design tree, resolving dependencies one by one.

For each question, provide your recommended answer. Ask one at a time. If a question can be answered by reading code, read the code instead.

Key areas to resolve:
- Scope boundaries (what's in, what's out)
- User stories and acceptance criteria
- Module boundaries and interfaces
- Testing strategy
- Migration or rollout concerns

### 4. Sketch modules

Identify the major modules to build or modify. Actively look for deep modules — ones that encapsulate complex functionality behind a simple, testable interface.

Check with the user:
- Do these modules match expectations?
- Which modules need tests?
- Are there reusable abstractions to extract?

### 5. Create the PRD

```bash
wiki create-prd <project> --feature <FEAT-ID> <name>
```

This scaffolds `projects/<project>/specs/prds/PRD-<nnn>-<slug>.md` with frontmatter and canonical sections.

### 6. Fill every section

The scaffold has these sections — fill all of them from interview and codebase exploration:

| Section | What to write |
|---------|--------------|
| **Problem** | The problem from the user's perspective. Why this matters now. |
| **Goals** | Specific, measurable outcomes. What success looks like. |
| **Non-Goals** | Explicitly out of scope. Prevents scope creep during slicing. |
| **Users / Actors** | Who interacts — humans, agents, services, CI. |
| **User Stories** | Extensive numbered list: `As a <actor>, I want <feature>, so that <benefit>`. Cover all aspects. |
| **Acceptance Criteria** | Checkboxes defining done. These become the basis for slice test plans. |
| **Prior Research** | Wikilinks to filed research: `[[research/projects/<project>/<slug>]]`. At least one link required. |
| **Open Questions** | Unresolved decisions. Address before slicing. `/grill-me` resolves these. |

Additionally, add these sections below Open Questions if implementation decisions were made:

**Implementation Decisions** — Architecture choices, module designs, schema changes, API contracts. Describe at the module/interface level. Do NOT include file paths or code snippets — they rot.

**Testing Decisions** — Which modules get tests, test approach (integration-first, boundary mocks), prior art in the codebase.

### 7. Update navigation and verify

```bash
wiki update-index <project> --write
wiki lint <project>
wiki lint-semantic <project>
```

## Execution Modes

### Non-trivial (full forge pipeline)

When part of `/forge`, this skill runs after `/research` and `/grill-me`:

```text
/research -> /grill-me -> /write-a-prd -> /prd-to-slices -> /tdd -> /wiki -> /improve-codebase-architecture -> /desloppify
```

The PRD captures all decisions from research and grilling. Every claim in the PRD should trace to filed research.

### Small scope (standalone)

For focused changes that still need a PRD but don't need full research:
- Skip `/research` if the problem space is well understood
- Still create the feature and PRD in the vault
- Still link to any existing research
- Follow with `/prd-to-slices` for decomposition

## What NOT to do

- Do not submit PRDs as GitHub issues. PRDs live in the wiki vault.
- Do not hand-write PRD files. Use `wiki create-prd` for correct frontmatter and structure.
- Do not skip `--feature`. Every PRD must be parented to a feature.
- Do not skip Prior Research. File research first, link it in the PRD.
- Do not include file paths or code snippets — they rot. Describe modules and interfaces.
- Do not create PRDs for trivial changes. Bug fixes under ~50 lines skip straight to `/tdd`.
