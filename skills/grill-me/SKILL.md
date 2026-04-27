---
name: grill-me
description: >
  Stress-test a plan or design through relentless interview until reaching shared understanding.
  Use when the user explicitly wants their approach challenged, wants ambiguities resolved, or says "grill me".
---

# Grill Me

Compatibility note: wiki-forge has moved the canonical pre-PRD design step to `/domain-model`.
Use `/domain-model` as the primary path for forge-driven work. Keep this skill as a compatibility surface for direct user requests, legacy prompts, or older docs that still mention grilling.

This skill is for structured plan pressure-testing, not the default forge design flow. Use it when the user explicitly asks for this mode or when an older workflow points here and the conversation still benefits from adversarial clarification.

Stress-test a plan, design, or PRD through structured interrogation. The goal is to surface hidden assumptions, resolve ambiguities, and reach shared understanding before implementation.

## When to Use

- When a user explicitly asks to be grilled, stress-tested, or challenged
- When older docs or prompts still reference `grill`
- When a PRD has unresolved `Open Questions`
- Before a major architecture decision that still needs defended assumptions
- When reviewing a plan that feels underspecified and the user wants active pushback

## When Not to Use

- For standard forge-driven pre-PRD work: use `/domain-model`
- For small bug fixes or focused refactors that do not need design decisions
- For continuing work where the relevant decisions are already resolved and documented

## Process

### 1. Understand the proposal before questioning

Read the relevant context first:
- If a PRD exists, read it from the wiki vault at `projects/<project>/specs/prds/`
- If research exists, read filed research under `research/<topic>/`; for project-scoped work, prefer `research/<project>/`
- Read relevant source code to ground the discussion in reality
- Read the project `_summary.md` for broader context

Do not ask the user to explain things you can determine by reading the docs, wiki vault, or code.

### 2. Interrogate systematically

Walk the design tree branch by branch.
For every turn:
- Ask one question at a time
- Include a recommended answer
- Wait for the user's response before moving on

Probe these dimensions as needed:

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
| **Alternatives** | Why this approach over simpler options? What was rejected and why? |
| **Scale** | Does this hold at 10x? 100x? Where does it break? |

### 3. Resolve decisions, not just gaps

For each ambiguity found:
- Propose a concrete resolution
- Get user agreement or an explicit counterproposal
- Record the outcome as a decision

Do not just list problems. Drive toward closure where possible.

### 4. Record outcomes

After grilling, update the relevant artifacts:

**If a PRD exists:** resolve relevant `Open Questions` and add implementation decisions.

**If pre-PRD:** feed the resolved decisions into `/write-a-prd`, unless the work should stay in the canonical forge path through `/domain-model`.

**If research-worthy decisions emerged:** file them with `wiki research file <topic> [--project <project>] <title>`. For project-scoped work, use `wiki research file <project> --project <project> <title>`.

## Integration with Forge

This skill exists as a compatibility surface, not as the canonical forge design step.

- For forge-driven pre-PRD work, use `/domain-model`
- For direct user requests like "grill me," honor the request and use this skill
- For older prompts/docs that still route here, continue only if adversarial questioning is actually useful

**Non-trivial work:** prefer `/domain-model` before writing the PRD so glossary, decisions, and context land in the wiki-native outputs.

**Continuation:** when continuing an existing PRD or slice, grill only the unresolved delta. Do not re-open settled decisions without cause.

**Feature-sized expansion:** if grilling reveals the scope is larger than a single PRD slice (multiple user-visible surfaces, multi-sprint effort, or crosses 2+ existing features), stop and route to `/forge` to create a new feature first. Do not silently expand a PRD to absorb feature-sized work.

## Rules

- If a question can be answered by reading code, read the code instead of asking.
- Do not grill on issues that are already decided and documented.
- Do not ask rhetorical questions; every question should drive toward a decision.
- Keep the session focused; follow tangents only if they materially affect the core design.
- Push back on unnecessary complexity; simpler is better until proven otherwise.
- If the user cannot answer a question, treat that as a finding and capture it as an open question for research.
- Preserve a relentless but useful cadence: one question at a time, each with a recommended answer.
- Default to compatibility behavior only for explicit user requests or legacy references; otherwise use `/domain-model` for forge-led domain modeling.

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:local`.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
