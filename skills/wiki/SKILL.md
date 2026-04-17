---
name: wiki
description: >
  Second brain for any knowledge work: capture, retrieval, verification, research, and drift detection.
  Applies to code projects, research topics, hobbies, journals — anything you want an agent to remember and keep honest.
  Use the `wiki` CLI for scaffolding, linting, retrieval, drift detection, verification, and filing research.
  For SDLC workflow policy (features, PRDs, slices, TDD, closeout), use the `forge` skill.
---

# Wiki

> **Scope:** memory, retrieval, verification, research filing, drift. For active implementation (feature/PRD/slice, cross-module refactor), load `/forge` instead — `/wiki` is not the workflow driver.

The wiki is compiled memory maintained by agents. Sources of truth live outside the wiki — in code, in filed research, in primary documents. The wiki records what was learned and keeps it honest as the sources change.

When sources change, the wiki updates. When the wiki drifts, the CLI catches it.

## Protocol Start Checklist

Run this **before** any wiki CLI call when the skill loads. It takes under 5 seconds and prevents silent drift.

1. **Confirm managed protocol is in sync.** Read the top block (between `<!-- *:agent-protocol:start -->` and `<!-- *:agent-protocol:end -->`) of the repo's `AGENTS.md` or `CLAUDE.md`. Verify it mentions: (a) `/wiki` and `/forge` split, (b) `wiki protocol sync` ownership of that block. If the block is missing, malformed, or looks stale vs. the current skill, run `wiki protocol audit <project> --repo <path>` before proceeding and surface the diff to the user. Do NOT hand-edit the managed block — use `wiki protocol sync` to re-install.
2. **Reconcile skill vs. protocol policy.** Scan the repo's un-managed `# CLAUDE` / `# AGENTS` section for the completion flow, hard gates, and handover rules. If any rule contradicts this skill (for example: a step marked "auto-run" here that the repo marks "user-only", or vice versa), the **repo instruction file wins for that project**, and you should name the conflict explicitly to the user rather than silently following one side.
3. **Record the entry point.** If the user is resuming an active slice, run `wiki resume <project> --repo <path> --base <rev>` to read the last handover/log state. Resume is read-only and safe to auto-run. Handover at session end is **user-invoked only** — see Operating Guidelines.
4. **When spawning sub-agents for wiki work, load `/wiki` in the sub-agent prompt.** Sub-agents do not inherit the parent's loaded skills. Without an explicit `Skill({ skill: "wiki" })` (or equivalent) at the top of the sub-agent prompt, the sub-agent will miss closeout sequencing, verification levels, and drift rules — producing silent gaps. This applies to closeout, verification, research filing, drift detection, or any other wiki lifecycle delegation.

Skip steps 1–2 only for pure retrieval (`wiki search`, `wiki query`, `wiki ask`, `wiki file-answer`) where no state is written.

## Invocation Model

Assume the harness can use both `/wiki` and `/forge`.
The decision is not capability — it is scope.

Use `/wiki` when the task stays in memory, research, retrieval, verification, drift, filing, or onboarding.
Escalate to `/forge` when the task is non-trivial software implementation (feature, cross-module change, refactor, or continuing an existing slice/PRD/feature thread).

When a harness uses different skill syntax, keep the same task boundary and still drive the work through the `wiki` CLI.
If a harness has no slash-skill syntax, run the equivalent `wiki` CLI lifecycle directly.

Sub-agent delegation rule lives in the Protocol Start Checklist above — follow it whenever this skill spawns agents.

Trigger this skill for requests like:
- "wiki refresh" / "wiki closeout"
- "update project wiki"
- "refresh project docs from code"
- "run wiki maintenance"
- "file this research"
- "audit research evidence"
- "answer a question from the vault"
- "find notes about X"

Do NOT trigger on generic phrases that could mean something else:
- "refresh memory" → could mean Claude Code auto-memory; ignore unless "wiki" is mentioned
- "sync docs" → could mean Notion, Confluence, etc.; ignore unless "wiki" or "project" is mentioned
- "update wiki" alone → could mean GitHub wiki; require "project" context or explicit `/wiki`

## Escalate to `/forge`

`/wiki` is not the workflow driver for active implementation. Hand off to `/forge` when the task involves creating or continuing a feature, PRD, or slice, a non-trivial behavior change, cross-module refactor or perf work, or any prompt that is effectively "proceed with the next slice." Forge is the sibling workflow layer that composes the same `wiki` CLI with research and TDD.

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
    _summary.md               # project overview (set repo: and code_paths: here for code projects)
    backlog.md                # tasks (only used when the project drives SDLC work)
    decisions.md / learnings.md
    modules/<mod>/spec.md     # code projects only
    architecture/ code-map/ contracts/ data/ changes/   # code projects only
    runbooks/ verification/ legacy/
  wiki/syntheses/             # filed answer briefs
  research/                   # filed research artifacts produced by /research or imported sources
```

For non-software vaults (research topics, hobbies, journals) only `index.md`, `projects/<name>/_summary.md`, and optional freeform folders under `projects/<name>/` are needed. The module/architecture/contracts/changes zones are SDLC-specific and live under `/forge`.

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
| Resume interrupted session | `wiki resume <project> --repo <path> --base <rev>` |
| Flag ad hoc repo markdown | `wiki lint-repo <project> --repo <path>` |
| Session handover for next agent | `wiki handover <project> --repo <path> --base <rev> [--harness <name>] [--no-write]` |
| Project dashboard | `wiki dashboard <project>` |
| Project summary | `wiki summary <project>` |
| Normalize a module spec | `wiki normalize-module <project> <module>` |
| Generate onboarding plan | `wiki onboard <project> --repo <path>` |
| Compact verify summary | `wiki verify <project>` |
| Refresh navigation indexes | `wiki update-index <project> --write` |
| Install git pre-commit hook | `wiki install-git-hook <project> --repo <path>` |
| Run commit-time checks | `wiki commit-check <project> --repo <path>` |
| Trigger refresh after merge | `wiki refresh-on-merge <project> --repo <path>` |
| Generate dependency graph | `wiki dependency-graph <project> --repo <path>` |
| Ingest a diff as change record | `wiki ingest-diff <project> --repo <path>` |

SDLC scaffolds (`create-feature`, `create-prd`, `create-issue-slice`, `start-slice`, `feature-status`, `start-feature`, `close-feature`, `start-prd`, `close-prd`, `next`, `claim`, `status`) are part of the forge workflow layer. They remain on the `wiki` CLI but are documented in the `forge` skill. Use `wiki help` for the full command list.

Verification levels (ascending): `scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`.
Demotion state: `stale` (set by `drift-check --fix` when source code changes after verification).

## Workflows

### 1. Onboard an Existing Project (brownfield)

For code projects:

```text
1. wiki scaffold-project <project>
2. wiki onboard <project> --repo <path>
3. Read specs/onboarding-plan.md
4. Set repo: and code_paths: in _summary.md frontmatter
5. optionally declare nested protocol scopes in `_summary.md` frontmatter: `protocol_scopes: [apps/api, packages/db]`
6. wiki discover <project> --repo <path> --tree
   → shows repo directories grouped by file count
   → directories with 3+ files are module candidates
7. Read the code in each candidate directory to understand its purpose
8. For each module you identify:
   wiki create-module <project> <module-name> --source <paths...>
   → then read the source and fill in the spec
9. wiki update-index <project> --write
10. wiki lint <project> && wiki verify-page <project> <module> code-verified
```

For non-code projects (research topics, hobbies, journals): `wiki scaffold-project <project>` and write `_summary.md` by hand. Skip the `repo:`, `code_paths:`, and module steps.

How to identify modules (code projects only): look for directories that own a distinct concern — a service, feature, data domain, or integration boundary. A module is NOT every file; it is a cohesive unit with its own interfaces, data model, and tests. When in doubt, start coarse and split later.

### 2. Refresh Docs After Source Changes

Use this when the user asks to update a project wiki, run wiki maintenance, or refresh pages from their sources, **after any implementation decisions are already made**.

If the user is really asking to start or continue non-trivial implementation work, escalate to `/forge` before using this refresh flow.

For active slice work, run the canonical 13-step sequence documented in `/forge` under "Canonical Code-Driven Closeout Sequence" — do not maintain a parallel copy here. For a refresh-only flow (no slice transition), the minimum is:

```text
1. wiki maintain <project> --base <rev>
2. wiki checkpoint <project> --repo <path>
3. For each impacted/stale page: read source, update wiki, verify-page.
4. If navigation changed: wiki update-index <project> --write
5. wiki closeout <project> --repo <path> --base <rev>   # review-only; expect "REVIEW PASS" if no slice is active
6. wiki gate <project> --repo <path> --base <rev>
```

If closeout surfaces slice work, switch to the canonical forge sequence — do not patch the slice state from inside a refresh.

### 3. Retrieval

```text
Quick lookup        → read the file directly
Broad search        → wiki search "auth middleware"
Hybrid semantic     → wiki query "how does approval work"
Project Q&A         → wiki ask <project> "where is approval implemented"
Verbose Q&A         → wiki ask <project> --verbose "where is approval implemented"
Save answer brief   → wiki file-answer <project> "question"
Resume session      → wiki resume <project> --repo <path> --base <rev>
End session         → wiki handover <project> --repo <path> --base <rev>  (only when the user asks)
```

Concrete examples:
```text
wiki search "auth middleware"
wiki query "how does approval work"
wiki ask wiki-forge --verbose "where is approval implemented"
wiki file-answer wiki-forge "what does closeout promote to test-verified"
```

### 4. File Research

After `/research` produces a report, file it into the vault:

```bash
wiki research file <project> <title>
```

This creates `research/projects/<project>/<slug>.md` by default and ensures `research/projects/<project>/_overview.md` exists. `wiki research ...` does not perform the investigation step; it stores, organizes, and validates research artifacts after you used `/research` or gathered source material elsewhere. Filing a note with `wiki research file` does **not** satisfy the forge research step by itself — you still need actual `/research` work first. Use `wiki research scaffold <topic>` for non-project topics, `wiki research ingest <topic> <source>` to seed a source-backed note, `wiki source ingest <path-or-url> [--topic <topic>]` to copy a source into `raw/` and scaffold a linked summary, and `wiki research lint` to catch missing evidence. PRDs should link to research via the `## Prior Research` section.

## Project Zones

Use these folders mechanically. All are second-brain zones applicable to any knowledge project:

- `modules/` — runtime/code ownership and verification (code projects only).
- `architecture/` — cross-module structure and design maps (code projects only).
- `code-map/` — repo/app/package/service maps and entrypoints (code projects only).
- `contracts/` — APIs, events, schemas, and boundary definitions (code projects only).
- `data/` — schema, entities, invariants, and relationships.
- `changes/` — rollout/migration/change records.
- `runbooks/` — operations and human procedures.
- `verification/` — coverage, checks, and test/runtime verification notes.
- `legacy/` — useful old docs kept as source material, not canonical truth.

SDLC-specific zones (`specs/features/`, `specs/prds/`, `specs/slices/`) and the feature → PRD → slice propagation rules belong to `/forge`.

General propagation rules:
- module/freeform-zone docs connect to planning via `source_paths` overlap
- run `wiki update-index <project> --write` after creating/moving pages or rebinding source paths so derived sections refresh across freeform project zones

## Data Planes

The CLI operates on 4 data planes. Understanding these helps agents predict what each command reads and writes.

| Data Plane | Commands | What it reads |
|---|---|---|
| Frontmatter | All page metadata, verification, bindings | YAML frontmatter in `.md` files |
| Markdown body | `backlog`, `lint`, `lint-semantic` | Heading structure, checkbox lists, TODO markers, wikilinks |
| Git history | `drift-check`, `refresh-from-git`, `maintain`, `gate`, `checkpoint` | `git log`, `git diff`, commit timestamps |
| Filesystem/globs | `discover`, `lint-repo`, code_paths scanning, source_paths | Directory structure, file patterns |

## Operating Guidelines

- **Never create wiki-style `.md` documentation inside project repos** except `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, and `skills/*/SKILL.md`. Notes, research, architecture, and maintained docs belong in the wiki vault.
- Use `wiki protocol sync <project> --repo <path>` to install/update the managed agent protocol block in repo `AGENTS.md` / `CLAUDE.md`; do not hand-maintain that top block.
- `wiki protocol sync` only syncs repo instruction files. It does not sync skill text or enforce the workflow by itself.
- **When editing wiki pages, write Obsidian-flavored markdown.** Prefer properties, wikilinks, embeds, callouts, and stable section headings over plain markdown walls of text.
- **Use the lightest Obsidian companion skill that fits.** `obsidian-markdown` should be common; `obsidian-cli`, `json-canvas`, and `obsidian-bases` are situational.
- **Use `wiki maintain` as the default maintenance entry point.** It composes refresh, discovery, and lint, but it does not replace `/forge` for non-trivial implementation work.
- **Minimize reads.** Start with `_summary.md`, then drill into specific zones.
- **Bind source paths early.** Unbound pages are invisible to drift detection. `wiki bind` defaults to replace; use `--mode merge` when adding bindings without dropping the existing set.
- **Set `repo:` in `_summary.md`** (for code projects) or pass `--repo <path>`.
- **Set `code_paths:` in `_summary.md`** to customize which directories are scanned (default: src, lib, app, packages, services, workers, server, api, functions, components, pages, routes, cmd, internal).
- **Verify after updating.** `wiki verify-page <project> <page> code-verified`.
- **Prefer `test-verified`** for critical pages once code and tests are both checked.
- **Keep navigation and derived relationship sections current.** `wiki update-index <project> --write` after creating/moving pages or rebinding source paths.
- **Use the log.** `wiki note <project> <message>` writes durable agent-to-agent context. `wiki log tail` shows recent entries.
- **Handover is user-invoked, never automatic.** Run `wiki handover <project> --repo <path> --base <rev>` only when the user explicitly asks for a handover (e.g. "handover", "end the session", "write a handover for the next agent"). Do not run it opportunistically at the end of a task, after a commit, or on your own judgment — the user decides when a session is done.
- **Never pipe `wiki handover` output through `head` or `tail`.** The next-session prompt block is the most important output and truncation silently eats it. The CLI now prints a one-line pointer at the top and the full prompt at the end (with the handover file path as the literal last line), so raw output is robust, but agents MUST stream it whole. If you need a capped output for tool results, use `--json` and read `.nextSessionPrompt` and `.handoverPath` — never truncate the text form.
- **Resume is safe to auto-run at session start.** `wiki resume <project> --repo <path> --base <rev>` only reads state; run it to read prior context without waiting for a prompt.
- **Don't invent CLI features.** If a command isn't listed here, it doesn't exist.
- **Do not invent document layouts.** Use the CLI-generated structure and fill it in; improve the generators when the structure is weak.
