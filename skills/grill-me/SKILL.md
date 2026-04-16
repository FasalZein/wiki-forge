---
name: grill-me
description: >
  Stress-test a plan or design through relentless interview until reaching shared understanding.
  Use when user wants to defend their approach, resolve ambiguities, or says "grill me".
---

# Grill Me

Stress-test a plan, design, or PRD through structured interrogation. The goal is to surface hidden assumptions, resolve ambiguities, and reach shared understanding before committing to implementation.

## When to Use

- Before writing a PRD (`/forge` step 2)
- When a PRD has unresolved Open Questions
- Before a major architecture decision
- When the user says "grill me", "stress test this", or "poke holes"
- When reviewing a plan that feels underspecified

## Process

### 1. Understand the proposal

Read the relevant context:
- If a PRD exists, read it from the vault (`projects/<project>/specs/prds/`)
- If research exists, read filed research (`research/projects/<project>/`)
- Read relevant source code to ground the discussion in reality
- Read the project `_summary.md` for broader context

Do not ask the user to explain things you can read.

### 2. Interrogate systematically

Walk each branch of the design tree. For every question:
- Ask ONE question at a time
- Provide your recommended answer
- Wait for the user's response before moving on

Cover these dimensions:

| Dimension | Questions to probe |
|-----------|-------------------|
| **Scope** | What's in? What's explicitly out? Where is the boundary fuzzy? |
| **Users** | Who benefits? Who is affected? What are the edge cases in user behavior? |
| **Architecture** | Which modules change? What are the interfaces? Where do boundaries sit? |
| **Data** | What state changes? Schema migrations? Backwards compatibility? |
| **Dependencies** | What must exist first? What blocks what? External dependencies? |
| **Testing** | How do you verify this works? What's hard to test? What breaks if this is wrong? |
| **Rollout** | Migration path? Feature flags? Rollback plan? |
| **Failure modes** | What happens when X fails? What's the blast radius? |
| **Alternatives** | Why this approach over simpler ones? What did you reject and why? |
| **Scale** | Does this hold at 10x? 100x? Where does it break? |

### 3. Resolve, don't just identify

For each ambiguity found:
- Propose a resolution
- Get user agreement
- Track it as a decision

Don't just list problems — solve them together.

### 4. Record outcomes

After grilling, update the relevant artifacts:

**If a PRD exists:** Update its Open Questions (resolve them) and add Implementation Decisions.

**If pre-PRD:** The resolved decisions feed directly into `/write-a-prd`.

**If research-worthy decisions emerged:** File them with `wiki research file <project> <title>`.

## Integration with Forge

In the `/forge` pipeline, grill-me sits between research and PRD writing:

```text
/research -> /grill-me -> /write-a-prd -> /prd-to-slices -> /tdd -> /wiki
```

**Non-trivial work:** Always grill before writing the PRD. The grilling resolves the Open Questions section so the PRD lands with fewer unknowns.

**Small scope:** Skip grilling for bug fixes and focused refactors that don't need design decisions.

**Continuation:** When continuing existing PRD/slice work, grill only the new delta — don't re-interrogate resolved decisions.

## Rules

- If a question can be answered by reading code, read the code instead of asking.
- Don't grill on things that are already decided and documented.
- Don't ask rhetorical questions. Every question should drive toward a decision.
- Keep the session focused. Follow tangents only if they affect the core design.
- Push back when the plan is overcomplicated. Simpler is better until proven otherwise.
- If the user can't answer a question, that's a finding — record it as an open question for research.
