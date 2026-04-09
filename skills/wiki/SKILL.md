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
| Default agent entry point | `wiki maintain <project> --base <rev>` |
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
wiki create-prd <project> <name>              # creates specs/prd-<slug>.md
wiki create-issue-slice <project> <title>     # creates specs/<TASK-ID>/{index,plan,test-plan}.md + backlog task
wiki create-plan <project> <name>
wiki create-test-plan <project> <name>
wiki backlog <project> [--json]
```

Current rule:
- PRD = project-level spec under `specs/`
- slice docs = task-scoped docs under `specs/<TASK-ID>/`

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

Use this when the user asks to update the project wiki, run wiki maintenance, refresh project docs from code, or close out a slice.

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

This creates `research/projects/<project>/<slug>.md` by default and ensures `research/projects/<project>/_overview.md` exists. `wiki research ...` does not perform the investigation step; it stores, organizes, and validates research artifacts after you used `/research` or gathered source material elsewhere. Use `wiki research scaffold <topic>` for non-project topics, `wiki research ingest <topic> <source>` to seed a source-backed note, `wiki source ingest <path-or-url> [--topic <topic>]` to copy a source into `raw/` and scaffold a linked summary, and `wiki research lint` to catch missing evidence. PRDs should link to research via the `## Prior Research` section.

## Operating Guidelines

- **Never create `.md` documentation inside project repos** except `README.md` and `CHANGELOG.md`. Specs, research, architecture notes, and maintained docs belong in the wiki vault.
- **When editing wiki pages, write Obsidian-flavored markdown.** Prefer properties, wikilinks, embeds, callouts, and stable section headings over plain markdown walls of text.
- **Use the lightest Obsidian companion skill that fits.** `obsidian-markdown` should be common; `obsidian-cli`, `json-canvas`, and `obsidian-bases` are situational.
- **Use `wiki maintain` as default entry point.** It composes refresh, discovery, and lint.
- **Minimize reads.** Start with `_summary.md`, then drill into modules.
- **Bind source paths early.** Unbound pages are invisible to drift detection.
- **Set `repo:` in `_summary.md`** or pass `--repo <path>`.
- **Set `code_paths:` in `_summary.md`** to customize which directories are scanned (default: src, lib, app, packages, services, workers, server, api, functions, components, pages, routes, cmd, internal).
- **Verify after updating.** `wiki verify-page <project> <page> code-verified`.
- **Prefer `test-verified`** for critical pages once code and tests are both checked.
- **Keep navigation current.** `wiki update-index <project> --write` after creating/moving pages.
- **Use the log.** `wiki log` gives durable session continuity outside chat history.
- **Don't invent CLI features.** If a command isn't listed here, it doesn't exist.
- **Do not invent document layouts.** Use the CLI-generated structure and fill it in; improve the generators when the structure is weak.
