# Production Cleanup Readiness

Use this checklist before starting cleanup or refactor slices intended to make wiki-forge safer for production use. It keeps broad cleanup work small, testable, and anchored to current Forge truth.

## When to run this checklist

Run it before starting a cleanup/refactor batch, after closing workflow-navigation fixes, and whenever an agent says the codebase needs broad cleanup. Do not use it to bypass Forge; use it to decide which small Forge slice should exist next.

Start from current truth:

```bash
wiki checkpoint <project> --repo <path> --base HEAD --json
wiki forge next <project> --repo <path> --json
```

If either command reports dirty, stale, active, ready, or draft work, handle that state before inventing new cleanup scope.

## Readiness checks

### CLI surface

- removed commands must not be advertised in help, docs, scripts, or benchmark defaults.
- Default help should show valid production commands users need without pointing to removed lifecycle paths.
- Top-level aliases must be intentional and tested; prefer `wiki forge ...` for lifecycle work.
- Guard with:

```bash
bun test tests/forge-kernel/command-surface.test.ts tests/cli-help.test.ts
```

### Install and sync behavior

- sync:local must not relink the global `wiki` CLI by default.
- Use `bun run sync:link-cli` only when intentionally pointing the global command at this checkout.
- Repo-owned skills should come from `skills/*/SKILL.md`; external optional skills should not be re-bundled under `skills/`.
- Install docs and scripts must agree about wiki-only, full, skip-skills, and explicit CLI relink behavior.

### Stale compatibility code

- Search for compatibility paths before refactoring them.
- If no production caller needs a compatibility shim, delete it instead of making it nicer.
- Scripts and benchmarks must not invoke removed commands or legacy command names.
- Keep compatibility only when it reads old durable artifacts that users may still have in their vault.

### Compatibility-preserving tests

- delete tests that preserve removed lifecycle paths instead of updating them.
- Keep tests that prove removed commands are absent, rejected, or migrated to current Forge commands.
- Avoid shallow tests that only lock old names such as `gate`, `closeout`, `pipeline`, or `backlog` unless the term is still a valid domain concept.

### Lifecycle terminology

- prefer Forge/status/checkpoint terminology over legacy gate/closeout wording when describing operator commands.
- Keep `gate` only for explicit evidence/readiness concepts, not as a public command name.
- Use `close`, `review`, `targeted verification`, `checkpoint`, and `Forge status` for current workflow truth.
- When terminology is ambiguous, update tests and docs in the same slice as the code change.

### Handoff and context continuity

- Do not reconstruct the prior conversation.
- Resume by reading the latest handover, checkpoint truth, Forge next/status truth, and explicitly referenced artifacts.
- Handoff and continuation payloads should stay compact and artifact-first; they should not embed full transcripts or broad wiki-query instructions.
- A no-open-slice state should tell the next agent how to refresh truth and how to plan more scope only when the user asks for it.

## Refactor slice rules

- Use one cleanup concern per Forge slice.
- Write the failing test before deleting or renaming behavior.
- Prefer runtime guards over docs-only cleanup when production behavior can drift again.
- Do not mix CLI surface cleanup, install behavior, compatibility deletion, lifecycle terminology, and handoff behavior in one slice.
- Record targeted verification with:

```bash
bun run check
```

Full-suite verification can be a release confidence check, but it is not a substitute for targeted slice proof.
