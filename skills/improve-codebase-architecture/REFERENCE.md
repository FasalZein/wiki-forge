# Reference

Adapted from Matt Pocock's `improve-codebase-architecture/REFERENCE.md` for
the wiki-forge workflow: the issue template is replaced with a wiki
research-note template.

## Dependency Categories

When assessing a candidate for deepening, classify its dependencies.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — just merge the
modules and test directly.

### 2. Local-substitutable

Dependencies that have local test stand-ins (e.g., PGLite for Postgres,
in-memory filesystem, ephemeral git repos via the test helpers already in
`tests/test-helpers.ts`). Deepenable if the test substitute exists. The
deepened module is tested with the local stand-in running in the test suite.

### 3. Remote but owned (Ports & Adapters)

Your own services across a network boundary (microservices, internal APIs).
Define a port (interface) at the module boundary. The deep module owns the
logic; the transport is injected. Tests use an in-memory adapter. Production
uses the real HTTP/gRPC/queue adapter.

Recommendation shape: "Define a shared interface (port), implement an HTTP
adapter for production and an in-memory adapter for testing, so the logic can
be tested as one deep module even though it's deployed across a network
boundary."

### 4. True external (Mock)

Third-party services (Stripe, Twilio, the actual `git` binary against a real
remote, etc.) you don't control. Mock at the boundary. The deepened module
takes the external dependency as an injected port, and tests provide a mock
implementation.

## Testing Strategy

The core principle: **replace, don't layer.**

- Old unit tests on shallow modules are waste once boundary tests exist —
  delete them as part of the refactor slice's TDD red-green-refactor cycle.
- Write new tests at the deepened module's interface boundary.
- Tests assert on observable outcomes through the public interface, not
  internal state.
- Tests should survive internal refactors — they describe behavior, not
  implementation.

For wiki-forge specifically, prefer the CLI-integration style already in
`tests/cli-smoke.test.ts` and `tests/automation.test.ts` when the boundary is
a user-facing command. Prefer the plain-import style in `tests/structure.test.ts`
or `tests/maintenance.test.ts` when the boundary is a pure function or internal
helper.

## Wiki Research-Note Template

Use this template when filling the research note created in Step 7 of
`SKILL.md`. It replaces Matt's GitHub issue template while keeping the same
four-section structure.

```markdown
---
title: Architecture Review — <YYYY-MM-DD>
type: research
topic: projects/<project>
project: <project>
source_paths:
  - <every repo-relative path in the chosen cluster>
status: current
verification_level: unverified
updated: <YYYY-MM-DD>
---

# Architecture Review — <YYYY-MM-DD>

> [!summary]
> Deepening review covering <cluster name>. Accepted candidate: <interface
> name> (see `Proposed Interface` below). Tracked as FEAT-<nnn> / PRD-<nnn>.

## TL;DR

- 1–3 bullets on what was found and what was chosen.

## Problem

Describe the architectural friction:

- Which modules are shallow and tightly coupled.
- What integration risk exists in the seams between them.
- Why this makes the codebase harder to navigate and maintain.
- Link impacted wiki pages: `[[projects/<project>/modules/<name>/spec]]`,
  `[[projects/<project>/architecture/<page>]]`.

## Candidates Considered

Numbered list of all the candidates surfaced in Step 3 (including the ones
that were NOT picked — their absence of signal is itself signal). For each:

- Cluster
- Dependency category
- Why rejected (for the non-picked ones)

## Proposed Interface

The chosen interface design:

- Interface signature (types, methods, params).
- Usage example showing how callers use it.
- What complexity it hides internally.
- Link to the full design output from the Step-5 sub-agent that produced it.

## Dependency Strategy

Which category applies and how dependencies are handled:

- **In-process**: merged directly.
- **Local-substitutable**: tested with `<specific stand-in>`.
- **Ports & adapters**: port definition, production adapter, test adapter.
- **Mock**: mock boundary for external services.

## Testing Strategy

- **New boundary tests to write**: describe behaviors to verify at the interface.
- **Old tests to delete**: list the shallow-module tests that become redundant.
- **Test environment needs**: any local stand-ins or adapters required. Link
  to the existing `tests/test-helpers.ts` helpers that will be reused.

## Implementation Recommendations

Durable architectural guidance that is NOT coupled to current file paths:

- What the module should own (responsibilities).
- What it should hide (implementation details).
- What it should expose (the interface contract).
- How callers should migrate to the new interface.

## Tracked Work

- Feature: `[[projects/<project>/specs/features/FEAT-<nnn>-<slug>]]`
- PRD: `[[projects/<project>/specs/prds/PRD-<nnn>-<slug>]]`
- Slices: filled in after `/prd-to-slices` runs.
- External issue (optional): `<GH issue URL>`

## Cross Links

- [[projects/<project>/_summary]]
- [[research/projects/<project>/_overview]]
```

## Optional GitHub Issue Template

Only used when the user opts into external tracking. The wiki note is the
source of truth; the issue is a pointer.

```markdown
## Tracks

- Wiki feature: projects/<project>/specs/features/FEAT-<nnn>-<slug>.md
- Wiki PRD: projects/<project>/specs/prds/PRD-<nnn>-<slug>.md
- Architecture review: research/projects/<project>/architecture-review-<YYYY-MM-DD>.md

## TL;DR

<copied verbatim from the wiki note's TL;DR>

## Scope

See the wiki PRD for full scope and acceptance criteria. This issue exists so
external collaborators / project boards can track shipping progress.
```
