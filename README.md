# wiki-forge

A local-first second brain for humans and LLMs — persistent, compounding knowledge maintained in markdown.

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

Manual qmd/runtime prerequisites when not using the installer:

```bash
npm install -g @tobilu/qmd@latest
# macOS recommended for Bun SDK hybrid retrieval
brew install sqlite
```

The installer sets up bun, links the CLI, installs qmd globally, configures your shell, and creates the vault directory. By default that means `~/Knowledge` is created for you on first setup. See [SETUP.md](SETUP.md) for manual setup, Obsidian config, and troubleshooting.

## Skills

The repo ships a small set of skills for maintaining the knowledge repository and, if you want, running a more opinionated planning workflow around it.

Repo skills from GitHub:

```bash
npx skills@latest add FasalZein/wiki-forge/skills/forge -g
npx skills@latest add FasalZein/wiki-forge/skills/wiki -g
npx skills@latest add FasalZein/wiki-forge/skills/prd-to-slices -g
```

Optional companion skills from `mattpocock/skills`:

```bash
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
```

Or from a local clone for the repo-owned skills:

```bash
npx skills@latest add ./skills/forge -g
npx skills@latest add ./skills/wiki -g
npx skills@latest add ./skills/prd-to-slices -g
```

| Skill | Invoke | Purpose |
|-------|--------|---------|
| **forge** | `/forge` | Optional orchestration layer for teams that want a stricter planning and implementation loop around the wiki |
| **wiki** | `/wiki` | CLI reference for wiki, research, raw-source, drift, and verification operations |
| **prd-to-slices** | `/prd-to-slices` | Breaks a larger plan into smaller tracked slices in the wiki backlog |
| **grill-me** | `/grill-me` | Stress-tests a plan before you commit it to the knowledge base |
| **write-a-prd** | `/write-a-prd` | Captures a durable planning note when you want formal project intent |
| **tdd** | `/tdd` | Optional implementation discipline for code changes that are tracked from the wiki |

`forge` is not the research system and not the wiki itself. It is an optional coordination layer:
- `research` = actual evidence gathering, comparison, and investigation
- `wiki` = maintained knowledge + verification/drift/gate operations
- `forge` = an opinionated wrapper for teams that want those steps tied together

Use `forge` only if you want that extra process. For many repos, the core value is just the maintained memory itself:
- knowledge maintenance: `wiki`
- research capture: `research` + `wiki research ...`
- small code fix: `tdd` + `wiki`
- wiki/note cleanup: `wiki` + `obsidian-markdown`
- repo understanding / maintenance: `wiki maintain`

Typical wiki trigger phrases should route to contextual maintenance, not blind note rewrites:
- "update wiki"
- "refresh memory"
- "sync docs"
- "close out this slice"

That means this exact sequence:

1. Inspect changed code/tests
2. `wiki refresh-from-git <project> --base <rev>`
3. `wiki drift-check <project> --show-unbound`
4. Update only impacted wiki pages from code
5. `wiki verify-page <project> <page> code-verified`
6. `wiki lint <project>`
7. `wiki lint-semantic <project>`
8. `wiki gate <project> --repo <path> --base <rev>`

## Layer Model

These are separate layers in the same system:

- **Wiki layer** — maintained project memory in `~/Knowledge`
- **Research layer** — filed evidence and source-backed notes under `research/` and `raw/`
- **Forge layer** — an optional workflow layer some teams use on top of the knowledge repository

Run the `/research` skill for the actual research work, then file the result into the research layer. If you use forge, it should consume that research layer and update the wiki layer. It should not own either one.

## Optional Forge Workflow

If you want a stricter process around implementation, use forge as the wrapper. Use `/research` for the investigation itself, and use wiki research/source commands to store the artifacts underneath it.

```bash
# run actual research first
/research "topic title"

# then file the resulting brief into the research repository
wiki research file wiki-forge "topic title"

# PRD + slices
wiki create-prd wiki-forge "feature name"          # creates specs/prd-<slug>.md
wiki create-issue-slice wiki-forge "slice name"   # creates specs/<TASK-ID>/{index,plan,test-plan}.md

# implementation + verification
# write tests first, then implement
wiki verify-page wiki-forge <page> code-verified
wiki gate wiki-forge --repo "$PWD" --base <rev>
```

That is the intended relationship: the wiki is the memory, `/research` investigates, and forge is optional orchestration.

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
wiki query "question"                 # SDK-first retrieval: BM25 for location/general queries, pre-expanded lex+vec hybrid for rationale queries
wiki ask <project> "question"         # project-scoped Q&A with citations
wiki research file <project> <title>   # file a research note after running /research
wiki research scaffold <topic>         # create a research topic container
wiki research status [topic]           # research repository coverage/health summary
wiki research ingest <topic> <source...> # scaffold one or many source-backed research pages from existing findings
wiki research lint [topic]              # lint filed research evidence and freshness
wiki source ingest <path-or-url...>     # ingest one or many raw sources + linked summaries

# Lint
wiki lint <project>                   # structural: frontmatter, wikilinks, headings
wiki lint-semantic <project>          # orphans, dead-ends, placeholders
wiki doctor <project>                 # health score (0-100) + top actions
wiki gate <project>                   # pass/fail quality check

# Maintain
wiki drift-check <project>            # stale + deleted + renamed source paths
wiki verify-page <project> <page...> <level>
wiki update-index <project> --write
wiki bind <project> <page> <paths>    # link wiki page to source code

# Scaffold
wiki scaffold-project <project>
wiki create-module <project> <name> --source <paths...>
wiki create-prd <project> <name>
wiki create-issue-slice <project> <title>  # creates specs/<TASK-ID>/{index,plan,test-plan}.md
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
    specs/
      prd-<slug>.md                # project-level PRDs
      index.md                     # generated spec index
      <TASK-ID>/
        index.md                   # task hub
        plan.md                    # implementation plan
        test-plan.md               # test plan
  research/                        # research artifacts
  wiki/syntheses/                  # filed answer briefs
```

## Current spec workflow

Use this shape:
- `wiki create-prd <project> <name>` → `projects/<project>/specs/prd-<slug>.md`
- `wiki create-issue-slice <project> <title>` → `projects/<project>/specs/<TASK-ID>/{index,plan,test-plan}.md`

So:
- PRD = project-level intent doc under `specs/`
- slice docs = task-scoped workspace under `specs/<TASK-ID>/`
- chronology = metadata, not filename numbering

## Obsidian

The vault is an [Obsidian](https://obsidian.md) vault. Wikilinks, graph view, backlinks, embeds, callouts, and properties should be treated as the default reading/writing experience for wiki pages.

Recommended skill install for agents editing vault docs:

```bash
npx skills add ./skills/wiki -g
npx skills add ~/.pi/agent/skills/obsidian-markdown -g
npx skills add ~/.agents/skills/obsidian-cli -g
npx skills add ~/.agents/skills/json-canvas -g
npx skills add ~/.agents/skills/obsidian-bases -g
```

Recommended usage split:
- `obsidian-markdown` — install and use by default for vault docs
- `obsidian-cli` — useful if Obsidian CLI is enabled and agents need to operate the running app
- `json-canvas` — useful for derived relationship maps and canvases; do not treat canvas files as source of truth
- `obsidian-bases` — useful for derived dashboards/views over frontmatter; do not treat bases as source of truth

Start with `obsidian-markdown`. Add the others because they complement the UI layer, but keep markdown/frontmatter as the canonical contract.

**Enable the CLI** (Obsidian 1.8+): Settings → General → CLI. This lets `wiki obsidian open` work from the terminal. See [SETUP.md](SETUP.md#obsidian-setup).

## Verification Levels

`scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`

Pages start at `scaffold` and get promoted as agents verify content against source code. `drift-check --fix` demotes stale pages when their source changes.

## Why This Works

The burden with knowledge bases isn't reading — it's bookkeeping. Cross-references, consistency, contradictions. Humans abandon wikis because maintenance cost grows faster than value.

Agents don't forget cross-references and can touch 15 files in one pass. The wiki sustains itself because maintenance cost approaches zero. You curate sources and ask good questions. Agents handle everything else.

## QMD benchmarking

Use an isolated qmd index when benchmarking retrieval so you do not pollute your main `~/.cache/qmd/index.sqlite` state.

```bash
QMD_INDEX_NAME=wiki-forge-bench bun src/index.ts qmd-setup
bun run bench:qmd
```

The benchmark harness copies markdown-only vault content into a temp vault, then measures:
- `qmd update`
- `qmd embed`
- direct qmd BM25/vector/expand/structured variants
- `wiki query` / `wiki ask` cold vs warm for structural, general, and rationale queries
- full `wiki source ingest -> qmd update -> qmd embed` pipeline latency

Current retrieval architecture:
- qmd SDK in-process for `wiki query` / `wiki ask`
- BM25 SDK path for location/general queries
- pre-expanded SDK hybrid (`lex` + `vec`, `rerank: false`) for rationale queries
- qmd CLI retained for maintenance/admin commands like `qmd-update`, `qmd-embed`, and `qmd-status`

## Testing

```bash
bun test
```

## License

MIT
