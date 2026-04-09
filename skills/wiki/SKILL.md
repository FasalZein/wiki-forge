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

For the full build workflow (research → grill → PRD → slices → TDD → verify), use `/forge`.
For Obsidian markdown syntax (wikilinks, callouts, embeds), use `/obsidian-markdown`.

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
  research/                   # filed research artifacts
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
| File research artifacts | `wiki file-research <project> <title>` |
| Save answer brief | `wiki file-answer <project> "<question>"` |

Planning scaffolds:

```bash
wiki create-prd <project> <name>
wiki create-issue-slice <project> <title>     # creates plan + test plan + backlog task
wiki create-plan <project> <name>
wiki create-test-plan <project> <name>
wiki backlog <project> [--json]
```

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
5. wiki lint and wiki verify-page after each slice
```

### 2. Refresh Docs After Code Changes

```text
1. wiki maintain <project> --base <rev>
2. wiki refresh-from-git <project> --base <rev>
3. wiki drift-check <project> --show-unbound
4. For each impacted/stale page: read source, update wiki, verify-page.
5. wiki lint <project> && wiki lint-semantic <project>
6. If navigation changed: wiki update-index <project> --write
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
wiki file-research <project> <title>
```

This creates `research/<project>-<slug>.md` with frontmatter linking to the project. Paste findings into the scaffolded page. PRDs should link to research via the `## Prior Research` section.

## Operating Guidelines

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
