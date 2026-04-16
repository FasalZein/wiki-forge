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

## Invocation Model

Assume the harness can use both `/wiki` and `/forge`.
The decision is not capability — it is scope.

Use `/wiki` when the task stays in memory, research, retrieval, verification, drift, or closeout.
Escalate to `/forge` only when the work becomes non-trivial implementation.

When a harness uses different skill syntax, keep the same task boundary and still drive the actual work through the `wiki` CLI.
If a harness has no slash-skill syntax, run the same `wiki` CLI lifecycle directly.

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

Treat those as contextual maintenance requests, not blind keyword matches. The canonical code-driven closeout sequence is:

1. `wiki checkpoint <project> --repo <path>` — freshness check
2. `wiki lint-repo <project> --repo <path>` — repo markdown violations
3. `wiki maintain <project> --repo <path> --base <rev>` — compose refresh + discovery
4. Update impacted wiki pages from code and tests
5. `wiki update-index <project> --write` — if navigation/planning links changed
6. `wiki verify-page <project> <page> code-verified`
7. `wiki verify-slice <project> <slice-id> --repo <path>` — for active slice work
8. `wiki closeout <project> --repo <path> --base <rev>` — review refresh/drift/lint/semantic/gate output
9. `wiki gate <project> --repo <path> --base <rev>`
10. `wiki close-slice <project> <slice-id> --repo <path> --base <rev>` — for active slice work

For the full build workflow (research → grill → PRD → slices → TDD → verify), use `/forge`. The wiki skill is the knowledge/verification layer; forge is a sibling workflow layer that composes the same `wiki` CLI with research and TDD.
Use `/forge` only for non-trivial pipeline work; do not trigger it for small fixes, note cleanup, or simple maintenance.
Today, `closeout` is a compact review surface, not an automatic repair step, and `gate` hard-blocks only on missing tests. Agents still need to perform the full lifecycle explicitly.

## Use Wiki vs Wiki-Forge

Use `/wiki` when the work is about memory, verification, retrieval, filing, drift, bindings, or closeout review.
Use `/forge` when the work is about planning and shipping non-trivial code changes.

Stay in `/wiki` for:
- `refresh-from-git`, `drift-check`, `verify-page`, `lint`, `gate`
- `research file`, `research lint`, `research audit`, `research status`, `source ingest`
- research-only investigation follow-up after `/research` has produced findings
- `ask`, `query`, `search`, `file-answer`
- wiki formatting, vault cleanup, and project onboarding

Escalate to `/forge` for:
- new features
- behavior changes across modules
- backlog slice selection or continuation
- refactors/perf work with design tradeoffs
- research that is part of a larger implementation pipeline
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

## Preconditions

- `wiki` CLI is already installed and available on `PATH`.
- The vault root is either configured with `KNOWLEDGE_VAULT_ROOT` or auto-detectable from the current working tree.
- Use `/obsidian-markdown` when editing vault markdown unless the task specifically needs another Obsidian companion skill.

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
| Git-independent worktree freshness check | `wiki checkpoint <project>` |
| Stale + unbound pages | `wiki drift-check <project> --show-unbound` |
| Re-verify updated pages | `wiki verify-page <project> <page> <level>` |
| Pass/fail completion gate | `wiki gate <project> --base <rev>` |
| Structural refactor gate | `wiki gate <project> --base <rev> --structural-refactor` |
| Compact closeout review | `wiki closeout <project> --base <rev>` |
| Broad health check | `wiki doctor <project> --base <rev>` |
| Find pages by topic | `wiki search "<query>"` or `wiki query "<query>"` |
| Project-scoped Q&A | `wiki ask <project> [--verbose] "<question>"` |
| Structural health | `wiki lint <project>` / `wiki lint-semantic <project>` |
| Discover repo structure for onboarding | `wiki discover <project> --tree` |
| Sync managed repo protocol files | `wiki protocol sync <project> --repo <path>` |
| Audit managed repo protocol files | `wiki protocol audit <project> --repo <path>` |
| File project research output | `wiki research file <project> <title>` |
| Create a research topic | `wiki research scaffold <topic>` |
| Check research repository health | `wiki research status [topic]` |
| Audit research quality | `wiki research audit [topic]` |
| Scaffold source-backed research notes | `wiki research ingest <topic> <source>` |
| Ingest raw source + summary | `wiki source ingest <path-or-url> [--topic <topic>]` |
| Lint filed research evidence | `wiki research lint [topic]` |
| Save answer brief | `wiki file-answer <project> [--verbose] "<question>"` |
| Start a slice safely | `wiki start-slice <project> <slice-id> [--agent <name>]` |
| Export slice prompt | `wiki export-prompt <project> <slice-id> [--agent codex|claude|pi]` |
| Resume interrupted session | `wiki resume <project> --repo <path> --base <rev>` |
| Flag ad hoc repo markdown | `wiki lint-repo <project> --repo <path>` |
| Recommend next slice | `wiki next <project>` |
| Claim a slice for an agent | `wiki claim <project> <slice-id> --agent <name>` |
| Add a note to current slice | `wiki note <project> <slice-id> <text>` |
| Session handover for next agent | `wiki handover <project> --repo <path> --base <rev> [--harness <name>] [--no-write]` |
| Project dashboard | `wiki dashboard <project>` |
| Project summary | `wiki summary <project>` |
| Slice/agent status | `wiki status <project>` |
| Normalize a module spec | `wiki normalize-module <project> <module>` |
| Generate onboarding plan | `wiki onboard <project> --repo <path>` |
| Compact verify summary | `wiki verify <project>` |
| Feature/PRD hierarchy status | `wiki feature-status <project> [--json]` |
| Start a feature lifecycle | `wiki start-feature <project> <FEAT-ID>` |
| Close a feature lifecycle | `wiki close-feature <project> <FEAT-ID> [--force]` |
| Start a PRD lifecycle | `wiki start-prd <project> <PRD-ID>` |
| Close a PRD lifecycle | `wiki close-prd <project> <PRD-ID> [--force]` |
| Refresh navigation indexes | `wiki update-index <project> --write` |
| Install git pre-commit hook | `wiki install-git-hook <project> --repo <path>` |
| Run commit-time checks | `wiki commit-check <project> --repo <path>` |
| Trigger refresh after merge | `wiki refresh-on-merge <project> --repo <path>` |
| Generate dependency graph | `wiki dependency-graph <project> --repo <path>` |
| Ingest a diff as change record | `wiki ingest-diff <project> --repo <path>` |

Planning scaffolds:

```bash
wiki create-feature <project> <name>          # creates specs/features/FEAT-<nnn>-<slug>.md
wiki create-prd <project> --feature <FEAT-ID> <name>
wiki create-issue-slice <project> <title> [--prd <PRD-ID>] [--assignee <agent>] [--source <path...>]   # creates specs/slices/<TASK-ID>/{index,plan,test-plan}.md + backlog task; --source overrides inherited parent PRD bindings
wiki create-plan <project> <name>             # creates specs/plan-<slug>.md and keeps it listed in specs/index.md
wiki create-test-plan <project> <name>        # creates specs/test-plan-<slug>.md and keeps it listed in specs/index.md
wiki backlog <project> [--assignee <agent>] [--json]
wiki add-task <project> <title> [--section Todo] [--prd <PRD-ID>] [--priority <p0-p2>] [--tag <tag>]
wiki move-task <project> <task-id> --to <section>
wiki complete-task <project> <task-id>               # shorthand for move-task --to Done
wiki start-slice <project> <slice-id> [--agent <name>] [--repo <path>] [--json]
wiki feature-status <project> [--json]                     # computed hierarchy status table
wiki start-feature <project> <FEAT-ID>                     # set status=in-progress; auto-triggered by start-slice
wiki close-feature <project> <FEAT-ID> [--force]           # set status=complete; auto-triggered by close-slice; gates on computed status
wiki start-prd <project> <PRD-ID>                          # set status=in-progress; auto-triggered by start-slice
wiki close-prd <project> <PRD-ID> [--force]                # set status=complete; auto-triggered by close-slice; gates on computed status
```

Current rule:
- feature = project-level planning scope under `specs/features/`
- PRD = numbered requirement doc under `specs/prds/`, linked to one parent feature
- slice docs = task-scoped docs under `specs/slices/<TASK-ID>/`, optionally linked to one parent PRD
- standalone plan/test-plan docs live directly under `specs/` and appear in `specs/index.md` under Planning Docs
- `create-issue-slice --prd <PRD-ID>` can inherit the parent PRD's `source_paths` when that PRD is already bound
- `create-issue-slice --assignee <agent>` writes assignee frontmatter into all generated slice docs
- `backlog --assignee <agent>` filters the queue and still surfaces blocked slices via `depends_on`
- `start-slice` is the lifecycle entry point: it enforces `depends_on`, detects claim conflicts, moves the backlog item to In Progress, records `started_at`, and prints a compact plan summary

Full command list: `wiki help`

Verification levels (ascending): `scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`.
Demotion state: `stale` (set by `drift-check --fix` when source code changes after verification).

## Workflows

### 1. Onboard an Existing Project (brownfield)

```text
1. wiki scaffold-project <project>
2. wiki onboard <project> --repo <path>
3. Read specs/onboarding-plan.md
4. Set repo: and code_paths: in _summary.md frontmatter
5. optionally declare nested protocol scopes in `_summary.md` frontmatter: `protocol_scopes: [apps/api, packages/db]`
6. wiki discover <project> --repo <path> --tree
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
5. Before implementation begins, register the slice:
   wiki start-slice <project> <slice-id> --agent <name> --repo <path>
6. After each slice, run the closeout sequence:
   wiki checkpoint <project> --repo <path>
   wiki lint-repo <project> --repo <path>
   wiki maintain <project> --repo <path> --base <rev>
   update impacted wiki pages from code
   wiki verify-page <project> <page> code-verified
   wiki verify-slice <project> <slice-id> --repo <path>
   wiki closeout <project> --repo <path> --base <rev>
   wiki gate <project> --repo <path> --base <rev>
   wiki close-slice <project> <slice-id> --repo <path> --base <rev>
```

### 2. Refresh Docs After Code Changes

Use this when the user asks to update the project wiki, run wiki maintenance, refresh project docs from code, or close out a slice **after the implementation path is already chosen**.

If the user is really asking to start or continue non-trivial implementation work, escalate to `/forge` before using this closeout flow.

```text
1. wiki maintain <project> --base <rev>
2. wiki checkpoint <project> --repo <path>
3. For each impacted/stale page: read source, update wiki, verify-page.
4. If navigation changed: wiki update-index <project> --write
5. wiki closeout <project> --repo <path> --base <rev>
6. wiki gate <project> --repo <path> --base <rev>
```

### 3. Retrieval

```text
Quick lookup        → read the file directly
Broad search        → wiki search "auth middleware"
Hybrid semantic     → wiki query "how does approval work"
Project Q&A         → wiki ask <project> "where is approval implemented"
Verbose Q&A         → wiki ask <project> --verbose "where is approval implemented"
Save answer brief   → wiki file-answer <project> "question"
Start work safely   → wiki start-slice <project> <slice-id> --agent pi
Export handoff      → wiki export-prompt <project> <slice-id> --agent pi
Resume session      → wiki resume <project> --repo <path> --base <rev>
End session         → wiki handover <project> --repo <path> --base <rev>
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
- `start-slice` auto-opens parent PRD and feature if they are still `not-started`; `close-slice` auto-closes them when all children are complete
- `feature-status` shows the computed hierarchy: `not-started → in-progress → needs-verification → complete`; `maintain` auto-writes `computed_status` frontmatter and detects lifecycle drift
- module/freeform-zone docs connect to planning via `source_paths` overlap
- standalone `create-plan` / `create-test-plan` docs stay visible in `specs/index.md`
- run `wiki update-index <project> --write` after creating/moving pages or rebinding source paths so derived sections refresh across spec pages and freeform project zones

## Data Planes

The CLI operates on 4 data planes. Understanding these helps agents predict what each command reads and writes.

| Data Plane | Commands | What it reads |
|---|---|---|
| Frontmatter | All page metadata, verification, bindings, slice state | YAML frontmatter in `.md` files |
| Markdown body | `backlog`, `lint`, `verify-slice`, `lint-semantic` | Heading structure, checkbox lists, TODO markers, wikilinks |
| Git history | `drift-check`, `refresh-from-git`, `maintain`, `gate`, `checkpoint` | `git log`, `git diff`, commit timestamps |
| Filesystem/globs | `discover`, `lint-repo`, code_paths scanning, source_paths | Directory structure, file patterns |

### Backlog format

The backlog parser uses regex on the markdown body. Task lines must match exactly:

```
- [ ] **TASK-ID** Title text | optional priority | #optional-tag
```

- Use `- [ ]` (unchecked checkbox) for all tasks, including those in the Done section.
- The section heading (`## In Progress`, `## Todo`, `## Backlog`, `## Done`, `## Cancelled`) determines task state.
- Lines that don't match the pattern are treated as extra content and preserved but invisible to the task parser.
- **Never use `- [x]`** — the parser only recognizes `- [ ]`. Using checked checkboxes silently drops tasks from the parsed backlog.

## Operating Guidelines

- **Never create wiki-style `.md` documentation inside project repos** except `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, and `skills/*/SKILL.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.
- Use `wiki protocol sync <project> --repo <path>` to install/update the managed agent protocol block in repo `AGENTS.md` / `CLAUDE.md`; do not hand-maintain that top block.
- `wiki protocol sync` only syncs repo instruction files. It does not sync skill text or enforce the workflow by itself.
- **When editing wiki pages, write Obsidian-flavored markdown.** Prefer properties, wikilinks, embeds, callouts, and stable section headings over plain markdown walls of text.
- **Use the lightest Obsidian companion skill that fits.** `obsidian-markdown` should be common; `obsidian-cli`, `json-canvas`, and `obsidian-bases` are situational.
- **Use `wiki maintain` as the default maintenance/closeout entry point.** It composes refresh, discovery, and lint, but it does not replace `/forge` for non-trivial implementation work.
- **For active slices, `wiki maintain` is the first closeout command, not the last.** Follow it with page updates, `verify-page`, `verify-slice`, `closeout`, `gate`, and `close-slice`.
- **Minimize reads.** Start with `_summary.md`, then drill into modules.
- **Bind source paths early.** Unbound pages are invisible to drift detection. `wiki bind` defaults to replace; use `--mode merge` when adding bindings without dropping the existing set.
- **Set `repo:` in `_summary.md`** or pass `--repo <path>`.
- **Set `code_paths:` in `_summary.md`** to customize which directories are scanned (default: src, lib, app, packages, services, workers, server, api, functions, components, pages, routes, cmd, internal).
- **Verify after updating.** `wiki verify-page <project> <page> code-verified`.
- **Prefer `test-verified`** for critical pages once code and tests are both checked.
- **Keep navigation, planning docs, and derived relationship sections current.** `wiki update-index <project> --write` after creating/moving pages or rebinding source paths.
- **Use the log.** `wiki note <project> <message>` writes durable agent-to-agent context. `wiki log tail` shows recent entries.
- **Always handover.** Run `wiki handover <project> --repo <path> --base <rev>` at session end. It captures what happened, what's dirty, and what to do next — the next agent reads this, not chat history.
- **Always resume.** Run `wiki resume <project> --repo <path> --base <rev>` at session start. It shows active task, recent commits, stale pages, and maintenance queue.
- **Don't invent CLI features.** If a command isn't listed here, it doesn't exist.
- **Do not invent document layouts.** Use the CLI-generated structure and fill it in; improve the generators when the structure is weak.
