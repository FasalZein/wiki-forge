---
name: write-a-prd
description: >
  Create a PRD/spec through user interview, codebase exploration, and module design, then feed it into Forge planning.
  Use when user wants to write a PRD, create a product requirements document, or plan a new feature.
---

# Write a PRD

Create the product/spec content that Forge planning needs. In wiki-managed projects, `wiki forge plan` owns feature/PRD/slice artifact creation and continuation.

Do not use removed legacy PRD commands. Forge planning owns feature, PRD/spec, and slice artifact creation.

## Prerequisites

1. Research should be filed when the problem space is not already understood. File it with `wiki research file <topic> [--project <project>] <title>` after using `/research`.
2. If domain modeling was needed, consume its wiki-native outputs before drafting:
   - `projects/<project>/decisions.md`
   - `projects/<project>/architecture/domain-language.md`
3. Start or resume the Forge planning session with:

```bash
wiki forge plan <project> <feature-name> --repo <path>
```

If no research exists and the feature depends on outside knowledge, route to `/research` first. If terminology or architecture boundaries are unclear, route to `/domain-model` before finalizing the PRD/spec content.

## Process

### 1. Gather problem context

Ask the user for a detailed description of:

- the problem they want to solve and who is affected
- constraints, deadlines, or dependencies
- solution ideas or prior art
- what should explicitly remain out of scope

If a domain-model pass already happened, read the decision log and domain-language page first so the PRD reuses established terms and trade-offs.

### 2. Explore the codebase

Read relevant source code to verify assertions and understand what exists. Do not write a PRD from memory. Focus on:

- existing modules that will be modified
- interfaces that constrain the design
- test patterns already in place
- related features or prior work

### 3. Interview the user

Interview relentlessly until there is shared understanding. Walk each branch of the design tree, resolving dependencies one by one.

For each question, provide your recommended answer. Ask one at a time. If a question can be answered by reading code, read the code instead.

Resolve:

- scope boundaries
- user stories and acceptance criteria
- module boundaries and interfaces
- testing strategy
- migration or rollout concerns
- HITL decisions that would block autonomous slices

### 4. Draft the PRD/spec content

Produce content for the Forge planning session with these sections:

| Section | What to write |
| --- | --- |
| **Problem** | The problem from the user's perspective. Why this matters now. |
| **Goals** | Specific, measurable outcomes. |
| **Non-Goals** | Explicitly out of scope. |
| **Users / Actors** | Humans, agents, services, CI, or other actors. |
| **User Stories** | Numbered stories: `As a <actor>, I want <feature>, so that <benefit>`. |
| **Acceptance Criteria** | Checkboxes defining done; these drive slice test plans. |
| **Prior Research** | Wikilinks to filed research, usually `[[research/<topic>/<slug>]]` or `[[research/<project>/<slug>]]`. |
| **Open Questions** | Unresolved decisions that must be answered or explicitly blocked. |
| **Implementation Decisions** | Architecture choices, module designs, schema changes, API contracts. Describe modules/interfaces, not brittle code snippets. |
| **Testing Decisions** | Which modules get tests, test style, and prior test patterns to follow. |

### 5. Feed the content into Forge planning

Use the prompt from:

```bash
wiki forge plan <project> <feature-name> --repo <path>
```

Answer the planning packet's questions with the PRD/spec content. Continue until Forge reports the planning session is complete enough to create or update feature, PRD/spec, and slice records.

Do not hand-write generated Forge artifacts unless the planning packet explicitly instructs you to edit a draft document. Kernel/CLI truth wins over skill text.

### 6. Verify readiness for slicing

Before handing off to `/prd-to-slices`, confirm:

- the problem and non-goals are clear
- every acceptance criterion can map to one or more vertical slices
- unresolved HITL questions are recorded
- research/domain decisions are linked or cited
- `wiki forge status <project> [slice-id] --repo <path>` does not ask for missing PRD/spec evidence you claim is complete

## Execution Modes

### Non-trivial full Forge pipeline

PRD/spec writing sits after `/domain-model` and before `/prd-to-slices`. See `skills/forge/SKILL.md` for the full chain.

### Small scope

For focused changes that still need a PRD/spec but do not need full research:

- skip `/research` only if the problem space is already understood
- still link any existing research or decisions
- use `wiki forge plan` to keep artifacts and lifecycle state Forge-owned
- follow with `/prd-to-slices` for decomposition

## What NOT to do

- Do not submit PRDs as GitHub issues. PRDs/specs live in the wiki/Forge memory layer.
- Do not use removed legacy PRD commands; use `wiki forge plan`.
- Do not skip prior research when claims depend on outside facts.
- Do not include brittle file-path-heavy implementation dumps. Describe modules and interfaces.
- Do not create PRDs for trivial changes. Tiny bug fixes may go straight to `/tdd` when Forge does not require planning.

## What happens next

After the PRD/spec content is accepted by Forge planning, hand off to `/prd-to-slices` to decompose it into vertical slices. Do not begin implementation from just PRD prose; slices and test plans gate the TDD loop.

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:full` for the full workflow install or `bun run sync:wiki` for wiki-only.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
