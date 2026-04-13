---
name: wiki
description: >
  LLM-maintained project wiki: compiled memory from code, not RAG.
  Use the `wiki` CLI for scaffolding, linting, retrieval, drift detection, gating, and verification.
  For SDLC workflow policy, use the `forge` skill.
---

# Wiki

Code is the source of truth. The wiki is compiled memory maintained by agents — not retrieved, not guessed.

When code changes, the wiki updates. When the wiki drifts, the CLI catches it.

## Harness Compatibility

`/wiki` works in any harness that can:
- run the `wiki` CLI
- read repo files and vault files
- edit markdown safely

It does not require subagents, background jobs, or rich UI. That makes it the more portable skill across harnesses.

Across skill-capable harnesses, the main remaining gaps are:
- uneven slash-command support
- weak session continuity for long wiki maintenance threads
- inconsistent support for opening/inspecting derived artifacts like `.canvas`

When a harness lacks slash commands, load the equivalent instructions manually and keep using the `wiki` CLI.

Trigger this skill for requests like:
- "wiki refresh" / "wiki closeout"
- "update project wiki"
- "refresh project docs from code"
- "close out this slice"
- "run wiki maintenance"
- "sync wiki from code/tests"

Do NOT trigger on generic phrases that could mean something else:
- "refresh memory" → could mean Claude Code auto-memory; ignore unless "wiki" is mentioned
- "sync docs" → could mean Notion, Confluence, etc.; ignore unless "wiki" or "project" is mentioned
- "update wiki" alone → could mean GitHub wiki; require "project" context or explicit `/wiki`

Treat those as contextual maintenance requests, not blind keyword matches. The concrete closeout sequence is:

1. Inspect changed code/tests
2. `wiki refresh-from-git <project> --base <rev>`
3. `wiki drift-check <project> --show-unbound`
4. Update only the impacted wiki pages from code
5. `wiki verify-page <project> <page> code-verified`
6. `wiki lint <project>`
7. `wiki lint-semantic <project>`
8. `wiki gate <project> --repo <path> --base <rev>`

For the full build workflow (research → grill → PRD → slices → TDD → verify), use `/forge`. The wiki skill is the knowledge/verification layer; forge is the workflow layer that composes it with research and TDD.
Use `/forge` only for non-trivial pipeline work; do not trigger it for small fixes, note cleanup, or simple maintenance.

## Use Wiki vs Wiki-Forge

Use `/wiki` when the work is about memory, verification, retrieval, filing, drift, bindings, or closeout.
Use `/forge` when the work is about planning and shipping non-trivial code changes.

Stay in `/wiki` for:
- `refresh-from-git`, `drift-check`, `verify-page`, `lint`, `gate`
- `research file`, `research lint`, `research audit`, `source ingest`
- `ask`, `query`, `search`, `file-answer`
- wiki formatting, vault cleanup, and project onboarding

Escalate to `/forge` for:
- new features
- behavior changes across modules
- backlog slice selection or continuation
- refactors/perf work with design tradeoffs
- any task where code changes are still being planned, implemented, or decomposed

Escalate from `/wiki` to `/forge` immediately when the task involves:
- creating or continuing a backlog slice
- creating or updating feature / PRD / slice docs as part of implementation
- a non-trivial behavior change
- cross-module refactor or perf work
- any request that is effectively "proceed with the next slice"

Do **not** let `/wiki` become the default workflow driver for active slice implementation. `/wiki` is for maintenance, filing, verification, and closeout.

Obsidian companion skills:
- `/obsidian-markdown` — default for editing vault markdown; use for properties, wikilinks, embeds, and callouts
- `/obsidian-cli` — use only when operating a running Obsidian app from the terminal
- `/json-canvas` — use only for derived `.canvas` artifacts, never as canonical state
- `/obsidian-bases` — use only for derived `.base` views over canonical markdown/frontmatter

## Setup

```bash
cd wiki-forge && bun install && bun link
export KNOWLEDGE_VAULT_ROOT=~/Knowledge   # when CLI repo ≠ vault
wiki help
```

Auto-detection: if `KNOWLEDGE_VAULT_ROOT` is unset, the CLI walks up from `cwd` looking for `AGENTS.md` + `index.md` + `projects/`.

## Vault Layout

```
<vault>/
  index.md                    # vault-wide entry point
  AGENTS.md                   # agent instructions
  projects/<name>/            # per-project docs
    _summary.md               # project overview (set repo: and code_paths: here)
    backlog.md
    decisions.md / learnings.md
    modules/<mod>/spec.md
    architecture/ code-map/ contracts/ data/ changes/
    runbooks/ verification/ legacy/ specs/
  wiki/syntheses/             # filed answer briefs
  research/                   # filed research artifacts produced by /research or imported sources
```

## Commands

| Need | Use |
|------|-----|
| Read a known page | direct file read |
| Default maintenance entry point | `wiki maintain <project> --base <rev>` |
| Changed files → impacted pages | `wiki refresh-from-git <project> --base <rev>` |
| Stale + unbound pages | `wiki drift-check <project> --show-unbound` |
| Re-verify updated pages | `wiki verify-page <project> <page> <level>` |
| Pass/fail completion gate | `wiki gate <project> --base <rev>` |
| Broad health check | `wiki doctor <project> --base <rev>` |
| Find pages by topic | `wiki search "<query>"` or `wiki query "<query>"` |
| Project-scoped Q&A | `wiki ask <project> "<question>"` |
| Structural health | `wiki lint <project>` / `wiki lint-semantic <project>` |
| Discover repo structure for onboarding | `wiki discover <project> --tree` |
| File project research output | `wiki research file <project> <title>` |
| Create a research topic | `wiki research scaffold <topic>` |
| Check research repository health | `wiki research status [topic]` |
| Scaffold source-backed research notes | `wiki research ingest <topic> <source>` |
| Ingest raw source + summary | `wiki source ingest <path-or-url> [--topic <topic>]` |
| Lint filed research evidence | `wiki research lint [topic]` |
| Save answer brief | `wiki file-answer <project> "<question>"` |

Planning scaffolds:

```bash
wiki create-feature <project> <name>          # creates specs/features/FEAT-<nnn>-<slug>.md
wiki create-prd <project> --feature <FEAT-ID> <name>
wiki create-issue-slice <project> <title> [--prd <PRD-ID>]   # creates specs/slices/<TASK-ID>/{index,plan,test-plan}.md + backlog task; inherits parent PRD source_paths when available
wiki create-plan <project> <name>             # creates specs/plan-<slug>.md and keeps it listed in specs/index.md
wiki create-test-plan <project> <name>        # creates specs/test-plan-<slug>.md and keeps it listed in specs/index.md
wiki backlog <project> [--json]
```

Current rule:
- feature = project-level planning scope under `specs/features/`
- PRD = numbered requirement doc under `specs/prds/`, linked to one parent feature
- slice docs = task-scoped docs under `specs/slices/<TASK-ID>/`, optionally linked to one parent PRD
- standalone plan/test-plan docs live directly under `specs/` and appear in `specs/index.md` under Planning Docs
- `create-issue-slice --prd <PRD-ID>` can inherit the parent PRD's `source_paths` when that PRD is already bound

Full command list: `wiki help`

Verification levels (ascending): `scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`.
Demotion state: `stale` (set by `drift-check --fix` when source code changes after verification).

## Workflows

### 1. Onboard an Existing Project (brownfield)

```text
1. wiki scaffold-project <project>
2. wiki onboard-plan <project> --repo <path> --write
3. Read specs/onboarding-plan.md
4. Set repo: and code_paths: in _summary.md frontmatter
5. wiki discover <project> --repo <path> --tree
   → shows repo directories grouped by file count
   → directories with 3+ files are module candidates
6. Read the code in each candidate directory to understand its purpose
7. For each module you identify:
   wiki create-module <project> <module-name> --source <paths...>
   → then read the source and fill in the spec
8. wiki update-index <project> --write
9. wiki lint <project> && wiki verify-page <project> <module> code-verified
```

How to identify modules: look for directories that own a distinct concern — a service, feature, data domain, or integration boundary. A module is NOT every file; it is a cohesive unit with its own interfaces, data model, and tests. When in doubt, start coarse and split later.

### 1b. Start a Greenfield Project

```text
1. wiki scaffold-project <project>
2. Set repo: in _summary.md frontmatter
3. Use /forge workflow: research → grill → PRD → slices → TDD
4. As code emerges, create modules:
   wiki create-module <project> <module-name> --source <paths...>
5. After each slice, run the closeout sequence:
   wiki refresh-from-git <project> --base <rev>
   wiki drift-check <project> --show-unbound
   wiki verify-page <project> <page> code-verified
   wiki lint <project> && wiki lint-semantic <project>
   wiki gate <project> --repo <path> --base <rev>
```

### 2. Refresh Docs After Code Changes

Use this when the user asks to update the project wiki, run wiki maintenance, refresh project docs from code, or close out a slice **after the implementation path is already chosen**.

If the user is really asking to start or continue non-trivial implementation work, escalate to `/forge` before using this closeout flow.

```text
1. wiki maintain <project> --base <rev>
2. wiki refresh-from-git <project> --base <rev>
3. wiki drift-check <project> --show-unbound
4. For each impacted/stale page: read source, update wiki, verify-page.
5. wiki lint <project> && wiki lint-semantic <project>
6. If navigation changed: wiki update-index <project> --write
7. wiki gate <project> --repo <path> --base <rev>
```

### 3. Retrieval

```text
Quick lookup        → read the file directly
Broad search        → wiki search "auth middleware"
Hybrid semantic     → wiki query "how does approval work"
Project Q&A         → wiki ask <project> "where is approval implemented"
Save answer brief   → wiki file-answer <project> "question"
```

### 4. File Research

After `/research` produces a report, file it into the vault:

```bash
wiki research file <project> <title>
```

This creates `research/projects/<project>/<slug>.md` by default and ensures `research/projects/<project>/_overview.md` exists. `wiki research ...` does not perform the investigation step; it stores, organizes, and validates research artifacts after you used `/research` or gathered source material elsewhere. Filing a note with `wiki research file` does **not** satisfy the forge research step by itself — you still need actual `/research` work first. Use `wiki research scaffold <topic>` for non-project topics, `wiki research ingest <topic> <source>` to seed a source-backed note, `wiki source ingest <path-or-url> [--topic <topic>]` to copy a source into `raw/` and scaffold a linked summary, and `wiki research lint` to catch missing evidence. PRDs should link to research via the `## Prior Research` section.

## Project Zones

Use these folders mechanically:

- `modules/` — runtime/code ownership and verification.
- `architecture/` — cross-module structure and design maps.
- `code-map/` — repo/app/package/service maps and entrypoints.
- `contracts/` — APIs, events, schemas, and boundary definitions.
- `data/` — schema, entities, invariants, and relationships.
- `changes/` — rollout/migration/change records tied to code.
- `runbooks/` — operations and human procedures.
- `verification/` — coverage, checks, and test/runtime verification notes.
- `legacy/` — useful old docs kept as source material, not canonical truth.
- `specs/features/` — planning scope parents.
- `specs/prds/` — numbered requirement docs.
- `specs/slices/` — execution slices.

Propagation rules:
- `feature -> PRD -> slice` is metadata-driven (`feature_id`, `prd_id`, `parent_feature`, `parent_prd`)
- `create-issue-slice --prd <PRD-ID>` auto-binds the new slice docs to that PRD's `source_paths` when the parent PRD is already bound
- module/freeform-zone docs connect to planning via `source_paths` overlap
- standalone `create-plan` / `create-test-plan` docs stay visible in `specs/index.md`
- `create-issue-slice --prd <PRD-ID>` inherits bound parent-PRD `source_paths` onto the generated slice docs when available
- run `wiki update-index <project> --write` after creating/moving pages or rebinding source paths so derived sections refresh across spec pages and freeform project zones

## Operating Guidelines

- **Never create wiki-style `.md` documentation inside project repos** except `README.md`, `CHANGELOG.md`, `AGENTS.md`, `SETUP.md`, and `skills/*/SKILL.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.
- **When editing wiki pages, write Obsidian-flavored markdown.** Prefer properties, wikilinks, embeds, callouts, and stable section headings over plain markdown walls of text.
- **Use the lightest Obsidian companion skill that fits.** `obsidian-markdown` should be common; `obsidian-cli`, `json-canvas`, and `obsidian-bases` are situational.
- **Use `wiki maintain` as the default maintenance/closeout entry point.** It composes refresh, discovery, and lint, but it does not replace `/forge` for non-trivial implementation work.
- **Minimize reads.** Start with `_summary.md`, then drill into modules.
- **Bind source paths early.** Unbound pages are invisible to drift detection. `wiki bind` defaults to replace; use `--mode merge` when adding bindings without dropping the existing set.
- **Set `repo:` in `_summary.md`** or pass `--repo <path>`.
- **Set `code_paths:` in `_summary.md`** to customize which directories are scanned (default: src, lib, app, packages, services, workers, server, api, functions, components, pages, routes, cmd, internal).
- **Verify after updating.** `wiki verify-page <project> <page> code-verified`.
- **Prefer `test-verified`** for critical pages once code and tests are both checked.
- **Keep navigation, planning docs, and derived relationship sections current.** `wiki update-index <project> --write` after creating/moving pages or rebinding source paths.
- **Use the log.** `wiki log` gives durable session continuity outside chat history.
- **Don't invent CLI features.** If a command isn't listed here, it doesn't exist.
- **Do not invent document layouts.** Use the CLI-generated structure and fill it in; improve the generators when the structure is weak.
