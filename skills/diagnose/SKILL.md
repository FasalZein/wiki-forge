---
name: diagnose
description: Disciplined diagnosis loop for bugs and performance regressions. Use when debugging failures, broken behavior, crashes, or slow paths.
---

<skill_context>
  <skill_dir>skills/diagnose</skill_dir>
  <workspace_dir>/Users/tothemoon/Dev/code-forge/knowledge-wiki-system</workspace_dir>

  <path_policy>
    Relative file references in this SKILL.md normally resolve from skill_dir when they exist there.
    Plain workspace commands like git status and bun test usually run in the workspace unless instructed otherwise.
    Use $PI_SKILL_DIR/path for explicit bundled skill files.
    Use $PI_WORKSPACE/path for explicit workspace/project files.
  </path_policy>
</skill_context>

## Wiki/Forge session context

For wiki-forge projects:

- Resolve the vault through `KNOWLEDGE_VAULT_ROOT`; if unset, run `wiki config --effective --repo <path>` or `wiki init <project> --repo <path>`.
- Do not create durable project memory markdown inside the code repo unless the repo itself is the configured vault.
- Forge-tracked use: obey the active Forge phase packet, its required skills, artifact owner, allowed writes, and next command.
- Standalone use: this skill can run without Forge; when durable memory is needed, route it through Wiki under `${KNOWLEDGE_VAULT_ROOT}/projects/<project>/`.

# Diagnose

A discipline for hard bugs. Skip phases only when explicitly justified.

## Phase 1 — Build a feedback loop

This is the skill. Create a fast, deterministic, agent-runnable pass/fail signal before hypothesising.

Try: failing test, CLI fixture, HTTP script, browser script, replayed trace, throwaway harness, property loop, bisection, or differential loop.

If you cannot build a loop, stop. Say what you tried and ask for access, captured artifacts, or permission to instrument.

## Phase 2 — Reproduce

Run the loop until it shows the user-described failure. Capture the exact symptom and make it repeatable enough to debug.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** that are falsifiable. Each must predict what observation or change would prove it wrong.

## Phase 4 — Instrument

Probe one variable at a time. Prefer debugger/REPL, then targeted logs. Tag temporary logs with `[DEBUG-...]` and remove them.

## Phase 5 — Fix + regression test

Turn the minimized repro into a failing test at the correct seam, then fix it and rerun the original loop. If no correct seam exists, document that finding.

## Phase 6 — Cleanup + post-mortem

Remove debug code and throwaway harnesses. State the winning hypothesis and what would have prevented the bug.

## Forge integration

Load this skill when diagnosing a Forge-tracked bug or performance regression.
If the fix becomes implementation work, create or continue a Forge slice.
Record TDD/verification through the active Forge phase packet.
**After diagnosis completes:** return to `/forge` — run `wiki forge next` to advance.
