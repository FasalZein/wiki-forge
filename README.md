# wiki-forge

A local-first [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — persistent, compounding knowledge maintained by agents.

The wiki sits between you and your source materials (code, research, docs). Agents handle the bookkeeping — cross-references, consistency, indexing, drift detection. You curate sources, ask questions, and think about meaning.

**Not RAG.** The wiki is a compiled artifact that grows over time, not a retrieval layer that re-derives answers from scratch each query.

## The Pattern

```
Sources (code, research, docs)  →  Wiki (markdown, agent-maintained)  →  You
```

| Layer | Who writes | Who reads | What |
|-------|-----------|-----------|------|
| **Sources** | You / external | Agents | Code repos, research docs, articles, data |
| **Wiki** | Agents | You + agents | Summaries, module specs, entity pages, cross-references |
| **Schema** | You + agents | Agents | Skills, CLI config, conventions (`AGENTS.md`, `_summary.md`) |

Knowledge lives in the wiki vault (`~/Knowledge`), **not** scattered across project repos. Code is the source of truth for behavior — the wiki is compiled memory that makes that code navigable across sessions.

## Core Operations

**Ingest** — Code changes or new sources arrive → agents update impacted wiki pages, refresh cross-references, log what changed. A single source change can touch 10-15 pages.

**Query** — Ask questions against the wiki. Answers come with citations. Valuable discoveries get filed back as wiki pages so explorations compound.

**Lint** — Health checks find stale pages, orphaned docs, missing cross-references, dead-end pages, and placeholder content. The CLI tells you what to investigate.

**Gate** — Pass/fail quality checks. Blocks on missing tests, warns on drift. Agents can't declare done until the gate passes.

## Install

```bash
git clone https://github.com/FasalZein/wiki-forge.git
cd wiki-forge
./install.sh
```

The installer sets up bun, links the CLI, configures your shell, and creates the vault directory. See [SETUP.md](SETUP.md) for manual setup, Obsidian config, and troubleshooting.

## Skills

Three skills ship with the repo. Install from GitHub — you'll be prompted to choose which agents to install for:

```bash
npx skills add FasalZein/wiki-forge/skills/forge -g
npx skills add FasalZein/wiki-forge/skills/wiki -g
npx skills add FasalZein/wiki-forge/skills/prd-to-slices -g
```

Or from a local clone:

```bash
npx skills add ./skills/forge -g
npx skills add ./skills/wiki -g
npx skills add ./skills/prd-to-slices -g
```

| Skill | Invoke | Purpose |
|-------|--------|---------|
| **forge** | `/forge` | Build workflow: research → grill → PRD → slices → TDD → verify |
| **wiki** | `/wiki` | CLI reference for all wiki operations |
| **prd-to-slices** | `/prd-to-slices` | Breaks PRDs into vertical slices in the wiki backlog |

## Guardrails

- **Wiki vault is the knowledge store.** Agents write documentation to `~/Knowledge`, not to project repos. Project repos are source inputs only.
- **Code is the source of truth.** Wiki pages are compiled from code, never the other way around. When they conflict, trust the code and update the wiki.
- **No docs in project repos.** If an agent tries to create markdown docs inside a project repo, redirect it to the wiki. Some project-local files are fine (README, CHANGELOG) but architecture docs, module specs, research — all go to the vault.
- **Verification prevents drift.** Every wiki page has a verification level. `drift-check` demotes pages when their source code changes. Stale pages get flagged, not trusted.

## CLI

```bash
# Start a session
wiki summary <project>               # one-shot project overview
wiki maintain <project>               # full maintenance queue (default agent entry point)

# Ingest
wiki refresh-from-git <project>       # map code changes → impacted wiki pages
wiki discover <project> --tree        # find uncovered files + detect research layers
wiki ingest-diff <project>            # auto-append change digests to impacted pages

# Query
wiki search "query"                   # full-text search
wiki query "question"                 # hybrid lex+vec retrieval
wiki ask <project> "question"         # project-scoped Q&A with citations
wiki research file <project> <title>   # scaffold project research page
wiki research scaffold <topic>         # create a research topic container
wiki research status [topic]           # research coverage/health summary
wiki research ingest <topic> <source>  # scaffold a source-backed research page
wiki research lint [topic]             # lint research evidence and freshness
wiki source ingest <path-or-url>       # ingest immutable raw source + linked summary

# Lint
wiki lint <project>                   # structural: frontmatter, wikilinks, headings
wiki lint-semantic <project>          # orphans, dead-ends, placeholders
wiki doctor <project>                 # health score (0-100) + top actions
wiki gate <project>                   # pass/fail quality check

# Maintain
wiki drift-check <project>            # stale + deleted + renamed source paths
wiki verify-page <project> <page> <level>
wiki update-index <project> --write
wiki bind <project> <page> <paths>    # link wiki page to source code

# Scaffold
wiki scaffold-project <project>
wiki create-module <project> <name> --source <paths...>
wiki create-prd <project> <name>
wiki create-issue-slice <project> <title>
wiki backlog <project>

# Obsidian
wiki obsidian open <note>             # requires Obsidian CLI enabled
wiki obsidian backlinks <note>
wiki obsidian orphans
```

Full list: `wiki help`

## Vault Layout

The wiki is a directory of markdown files — works as a git repo, an Obsidian vault, or both.

```
~/Knowledge/
  index.md                         # vault entry point
  log.md                           # chronological operation log
  projects/<name>/
    _summary.md                    # project config (repo, code_paths)
    backlog.md                     # task tracking
    modules/<mod>/spec.md          # module documentation
    specs/                         # PRDs, plans, test plans
  research/                        # research artifacts
  wiki/syntheses/                  # filed answer briefs
```

## Obsidian

The vault is an [Obsidian](https://obsidian.md) vault. Wikilinks, graph view, and backlinks work out of the box.

**Enable the CLI** (Obsidian 1.8+): Settings → General → CLI. This lets `wiki obsidian open` work from the terminal. See [SETUP.md](SETUP.md#obsidian-setup).

## Verification Levels

`scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`

Pages start at `scaffold` and get promoted as agents verify content against source code. `drift-check --fix` demotes stale pages when their source changes.

## Why This Works

The burden with knowledge bases isn't reading — it's bookkeeping. Cross-references, consistency, contradictions. Humans abandon wikis because maintenance cost grows faster than value.

Agents don't forget cross-references and can touch 15 files in one pass. The wiki sustains itself because maintenance cost approaches zero. You curate sources and ask good questions. Agents handle everything else.

## Testing

```bash
bun test
```

## License

MIT
