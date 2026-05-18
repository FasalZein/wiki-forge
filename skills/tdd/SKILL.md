---
name: tdd
description: Behavior-first red-green-refactor testing. Use when building features, fixing bugs, or needing integration tests.
---

<skill_context>
  <skill_dir>skills/tdd</skill_dir>
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

# Test-Driven Development

## Philosophy

Tests should verify behavior through public interfaces, not implementation details.

**Good tests** are integration-style: they exercise real code paths through public APIs and describe what the system does.

Bad tests mock internals, test private methods, or break when behavior stays the same. See [tests.md](tests.md), [mocking.md](mocking.md), [interface-design.md](interface-design.md), and [deep-modules.md](deep-modules.md).

## Anti-Pattern: Horizontal Slices

DO NOT write all tests first, then all implementation.

Horizontal RED/GREEN creates tests for imagined behavior. Correct approach: Vertical slices via tracer bullets.

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
```

## Workflow

1. Read domain language and ADRs before naming tests.
2. Ask: "What should the public interface look like? Which behaviors are most important to test?"
3. Write one failing behavior test through the public interface.
4. Write minimal code to pass.
5. Repeat one behavior at a time.
6. Refactor only while green; Never refactor while RED.

## Checklist

- Test describes behavior, not implementation.
- Test uses public interface only.
- Test would survive internal refactor.
- No speculative features added.

## Forge integration

Load this skill when the phase packet lists `tdd`.
Record red/green with `wiki forge tdd cycle <project> <slice>`.
Record targeted verification with `wiki forge evidence <project> <slice> verify`.
the preferred `tdd cycle` command may use different red and green commands when they share a `--test` path.
**After TDD completes:** return to `/forge` — run `wiki forge next` to advance.
