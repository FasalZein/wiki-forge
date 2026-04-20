---
name: domain-model
description: Stress-test a plan against the existing domain model, sharpen terminology, and record decisions/context in the project's canonical knowledge surfaces as they crystallise. Use when user wants to challenge a plan against the project's language and documented decisions.
disable-model-invocation: true
---

For wiki-forge-managed projects, the domain-model phase is wiki-native:

- Canonical decisions belong in the wiki vault, usually `projects/<project>/decisions.md`, not repo-local `docs/adr/`.
- Canonical glossary/context artifacts also belong in the wiki layer, for example `projects/<project>/architecture/domain-language.md`, not repo-root `CONTEXT.md`.
- `wiki` remains the second-brain layer; `forge` decides when domain-modeling is part of a software-delivery workflow.

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Pre-PRD Outputs

Produce these artifacts before `write-a-prd`:

- **Decision log:** append durable, hard-to-reverse decisions to `projects/<project>/decisions.md`.
- **Domain language page:** keep glossary, relationships, and flagged ambiguities in `projects/<project>/architecture/domain-language.md`.
- **Open ambiguities:** leave unresolved questions visible so `write-a-prd` can consume them explicitly instead of rediscovering the same uncertainty.

`write-a-prd` should consume these outputs, not recreate them from scratch.

## Forge Ledger Expectations

For forge-managed projects, the domain-model phase is considered complete only when the workflow can point at durable evidence, not just discussion:

- `projects/<project>/decisions.md` contains concrete decision entries, not an empty scaffold
- the decision surface yields durable `decisionRefs`
- `projects/<project>/architecture/domain-language.md` captures the resulting terminology/context, especially when terms were clarified or redefined

Operationally, if `wiki forge status` still reports:
- `domain-model.completedAt`
- `domain-model.decisionRefs`

then the workflow does not yet consider the phase complete, even if the files exist.

When debugging ledger completion, verify the evidence, not just file existence.

## Domain awareness

During codebase exploration, also look for existing documentation:

### Canonical lookup order

For wiki-forge-managed projects, read the canonical surfaces in this order:

1. `projects/<project>/architecture/domain-language.md`
2. `projects/<project>/decisions.md`
3. Repo-local fallback files only if the project explicitly keeps context artifacts in-repo

### Repo-local fallback structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

For wiki-forge-managed projects, translate those outputs into the wiki's canonical surfaces instead of creating repo files. Repo-local markdown is a fallback only for projects that explicitly keep context artifacts in-repo.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the canonical domain-language page, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?" If the project uses repo-local fallback docs, apply the same rule there.

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update context/glossary inline

When a term is resolved, update the canonical context/glossary surface right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md). For wiki-forge-managed projects, that means a wiki page such as `projects/<project>/architecture/domain-language.md`.

### Offer decisions sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md). For wiki-forge-managed projects, record the decision in the wiki's decision surface instead of creating `docs/adr/`.
