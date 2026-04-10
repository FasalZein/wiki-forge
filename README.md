<p align="center">
  <strong>wiki-forge</strong><br>
  <em>A local-first second brain for humans and LLMs</em>
</p>

<p align="center">
  Persistent, compounding knowledge maintained in markdown.<br>
  Agents handle the bookkeeping. You handle the thinking.
</p>

---

**Not RAG.** The wiki is a compiled artifact that grows over time, not a retrieval layer that re-derives answers from scratch each query. Code is always the source of truth — the wiki is compiled memory that makes code navigable across sessions.

```
Sources (code, research, docs)  -->  Wiki (markdown, agent-maintained)  -->  You
```

## Quick Start

```bash
git clone https://github.com/FasalZein/wiki-forge.git
cd wiki-forge
./install.sh
```

The installer handles bun, dependencies, global CLI linking, global qmd, shell config, and the vault directory (`~/Knowledge`). See [SETUP.md](SETUP.md) for manual setup, Obsidian config, and troubleshooting.

<details>
<summary><strong>Manual prerequisites</strong> (if not using the installer)</summary>

```bash
npm install -g @tobilu/qmd@latest
brew install sqlite   # macOS — required for Bun SDK hybrid retrieval
```

</details>

---

## Features

### Project Onboarding

Scaffold a project, discover its structure, and create module specs — all wired to the vault.

```bash
wiki scaffold-project my-app                              # create vault structure
wiki onboard-plan my-app --repo ~/Dev/my-app --write      # generate onboarding plan
wiki discover my-app --tree                                # find module candidates
wiki create-module my-app auth --source src/auth/          # create bound module spec
```

### Knowledge Maintenance

The core loop: code changes, the wiki updates, drift gets caught.

```bash
wiki maintain my-app --base main                           # default agent entry point
wiki refresh-from-git my-app --base main                   # map git changes -> impacted pages
wiki drift-check my-app --show-unbound                     # find stale + unbound pages
wiki ingest-diff my-app --base main                        # auto-append change digests
wiki verify-page my-app modules/auth/spec code-verified    # promote verification level
wiki bind my-app modules/auth/spec src/auth/               # link page to source files
```

### Quality Gates

Every closeout runs through lint, semantic lint, and a pass/fail gate.

```bash
wiki lint my-app                                           # structural: frontmatter, wikilinks, headings
wiki lint-semantic my-app                                  # semantic: orphans, dead-ends, placeholders
wiki doctor my-app                                         # health score (0-100) + prioritized actions
wiki gate my-app --repo ~/Dev/my-app --base main           # pass/fail — blocks on missing tests
```

### Retrieval and Search

Intent-aware retrieval — BM25 for location queries, hybrid BM25+vector for rationale queries.

```bash
wiki search "auth middleware"                              # full-text search
wiki query "how does token refresh work"                   # intent-routed retrieval
wiki ask my-app "where is the rate limiter"                # project-scoped Q&A with citations
wiki file-answer my-app "how does caching work"            # save answer brief for compounding
```

### Research Layer

File evidence, scaffold topics, ingest sources — all traceable in the vault.

```bash
wiki research file my-app "auth provider comparison"       # file a research note
wiki research scaffold "state management"                  # create topic container
wiki research ingest "state management" ./notes.md         # seed from existing findings
wiki research status                                       # coverage + health summary
wiki research lint                                         # check evidence freshness
wiki source ingest https://example.com/article             # raw source -> raw/ + linked summary
```

### Planning and Backlog

Features, PRDs, and vertical slices with task-scoped spec hubs — zero API calls.

```bash
wiki create-feature my-app "user onboarding"               # -> specs/features/FEAT-001-user-onboarding.md
wiki create-prd my-app --feature FEAT-001 "email signup"   # -> specs/prds/PRD-001-email-signup.md
wiki create-issue-slice my-app "email verification" --prd PRD-001
wiki backlog my-app                                        # list tracked tasks
```

### Navigation and Index

```bash
wiki summary my-app                                        # one-shot project overview
wiki update-index my-app --write                           # regenerate spec indexes + derived planning links
wiki log                                                   # chronological operation log
```

### Obsidian Integration

The vault is a native [Obsidian](https://obsidian.md) vault — wikilinks, graph view, backlinks, embeds, callouts, and properties work out of the box.

```bash
wiki obsidian open modules/auth/spec                       # open in Obsidian (requires CLI enabled)
wiki obsidian backlinks modules/auth/spec                  # show backlinks
wiki obsidian orphans                                      # find orphan notes
```

Enable the CLI: Obsidian 1.8+ -> Settings -> General -> CLI. See [SETUP.md](SETUP.md#obsidian-setup).

---

## How It Works

### The Three Layers

| Layer | What it is | Who owns it |
|-------|-----------|-------------|
| **Wiki** | Maintained project memory in `~/Knowledge` | `wiki` CLI |
| **Research** | Filed evidence and source-backed notes under `research/` and `raw/` | `/research` skill + `wiki research` commands |
| **Forge** | Optional workflow layer: research -> grill -> PRD -> slices -> TDD -> verify | `/forge` skill |

These are separate concerns. The wiki is the knowledge store. Research is evidence. Forge is optional process.

### Verification Levels

Every wiki page has a verification level that tracks how current it is:

```
scaffold  ->  inferred  ->  code-verified  ->  runtime-verified  ->  test-verified
```

When source code changes after verification, `drift-check` demotes the page to `stale`. Stale pages get flagged, not trusted.

### Mandatory Closeout Sequence

Every workflow — feature, bug fix, slicing, maintenance — ends with the same sequence:

```bash
# 1. Map changes to impacted pages
wiki refresh-from-git <project> --base <rev>

# 2. Detect drift
wiki drift-check <project> --show-unbound

# 3. Update impacted wiki pages from code (manual step)

# 4. Re-verify updated pages
wiki verify-page <project> <page> code-verified

# 5. Structural lint
wiki lint <project>

# 6. Semantic lint
wiki lint-semantic <project>

# 7. Pass/fail gate
wiki gate <project> --repo <path> --base <rev>
```

No step is optional. Agents cannot declare done until `gate` exits 0.

### Trigger Phrases

These phrases route to the closeout sequence above:

- "wiki refresh" / "wiki closeout"
- "update project wiki"
- "refresh project docs from code"
- "close out this slice"
- "run wiki maintenance"

> **Disambiguation:** Avoid "refresh memory" (clashes with Claude Code auto-memory), "sync docs" (ambiguous with Notion/Confluence), or bare "update wiki" (ambiguous with GitHub wiki). Always include "wiki", "project", or "slice" for clear routing.

---

## Vault Layout

```
~/Knowledge/
  index.md                            # vault entry point
  log.md                              # chronological operation log
  projects/<name>/
    _summary.md                       # project config (repo, code_paths)
    backlog.md                        # task tracking
    decisions.md                      # decision log
    learnings.md                      # lessons learned
    modules/<mod>/spec.md             # module documentation
    specs/
      index.md                        # generated spec index
      features/
        index.md
        FEAT-<nnn>-<slug>.md          # canonical feature hubs
      prds/
        index.md
        PRD-<nnn>-<slug>.md           # project-level PRDs scoped to a feature
      slices/
        index.md
        <TASK-ID>/
          index.md                    # task hub
          plan.md                     # implementation plan
          test-plan.md                # test plan
  research/                           # research artifacts
  raw/                                # ingested raw sources
  wiki/syntheses/                     # filed answer briefs
```

---

## Project Zones

- `modules/` — runtime/code ownership. What code exists, what it owns, and how it is verified.
- `architecture/` — cross-module topology, boundaries, and high-level design maps.
- `code-map/` — repo/package/service maps, entrypoints, and where behavior lives.
- `contracts/` — APIs, events, schemas, and external/internal interface surfaces.
- `data/` — tables, entities, migrations, invariants, and relationships.
- `changes/` — rollouts, migrations, change plans, and notable implementation deltas.
- `runbooks/` — operational procedures, incident handling, and recurring manual workflows.
- `verification/` — coverage, test strategy, runtime checks, and closeout evidence.
- `legacy/` — old docs kept as source material, not canonical truth.
- `specs/features/` — product/planning scopes.
- `specs/prds/` — numbered requirement docs under one parent feature.
- `specs/slices/` — execution slices under an optional parent PRD.

Propagation rule:
- planning lineage (`feature -> PRD -> slice`) comes from metadata
- module/freeform-zone linkage comes from `source_paths` overlap
- `wiki update-index <project> --write` regenerates those derived sections

---

## Skills

### Repo-Owned Skills

```bash
npx skills@latest add FasalZein/wiki-forge/skills/forge -g
npx skills@latest add FasalZein/wiki-forge/skills/wiki -g
npx skills@latest add FasalZein/wiki-forge/skills/prd-to-slices -g
```

### Companion Skills (optional)

```bash
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
```

### Skill Reference

| Skill | Invoke | What it does | When to use |
|-------|--------|-------------|-------------|
| **wiki** | `/wiki` | CLI operations: maintenance, drift, verification, gates | Always — the operational surface |
| **forge** | `/forge` | Orchestrates research -> grill -> PRD -> slices -> TDD -> verify | Non-trivial features crossing module boundaries |
| **prd-to-slices** | `/prd-to-slices` | Breaks a PRD into tracked vertical slices in the wiki backlog | After writing a PRD, before implementation |
| **grill-me** | `/grill-me` | Stress-tests a plan before committing to it | Before writing a PRD |
| **write-a-prd** | `/write-a-prd` | Captures problem, scope, modules, acceptance criteria | When you need formal project intent |
| **tdd** | `/tdd` | Red-green-refactor for each slice | During implementation |

### When to Use What

| Task | Workflow |
|------|----------|
| Knowledge maintenance | `/wiki` |
| Research capture | `/research` + `wiki research file` |
| Small code fix (< 50 lines) | `/tdd` + `/wiki` |
| Wiki / note cleanup | `/wiki` + `/obsidian-markdown` |
| Repo exploration | `wiki maintain` |
| New feature or cross-module change | `/forge` (full pipeline) |

---

## Forge Workflow

For non-trivial work, forge orchestrates the full pipeline:

```
/research  ->  /grill-me  ->  /write-a-prd  ->  /prd-to-slices  ->  /tdd  ->  /wiki
```

```bash
# 1. Investigate
/research "topic title"
wiki research file my-app "topic title"

# 2. Stress-test the plan
/grill-me

# 3. Create the parent feature + PRD
wiki create-feature my-app "feature name"
wiki create-prd my-app --feature FEAT-001 "prd name"

# 4. Break into slices
wiki create-issue-slice my-app "slice name" --prd PRD-001

# 5. Implement (TDD)
# write tests first, then implement, then refactor

# 6. Close out (mandatory sequence)
wiki refresh-from-git my-app --base main
wiki drift-check my-app --show-unbound
# update impacted pages
wiki verify-page my-app <page> code-verified
wiki lint my-app
wiki lint-semantic my-app
wiki gate my-app --repo ~/Dev/my-app --base main
```

---

## Guardrails

- **Wiki vault is the knowledge store.** Agents write documentation to `~/Knowledge`, not to project repos.
- **Code is the source of truth.** Wiki pages compile from code, never the other way around.
- **No docs in project repos.** Architecture docs, module specs, research — all go to the vault. Only `README.md` and `CHANGELOG.md` stay in repos.
- **Verification prevents drift.** Every page has a verification level. `drift-check` demotes stale pages when source code changes.

---

## Obsidian

The vault is a first-class Obsidian vault. Recommended companion skills for agents editing vault docs:

| Skill | When to use |
|-------|-------------|
| `obsidian-markdown` | Default for vault markdown — properties, wikilinks, embeds, callouts |
| `obsidian-cli` | Only when operating a running Obsidian app from the terminal |
| `json-canvas` | Derived relationship maps — never as canonical state |
| `obsidian-bases` | Derived dashboards/views — never as canonical state |

Start with `obsidian-markdown`. The others complement the UI layer but markdown/frontmatter is the canonical contract.

---

## Retrieval Architecture

The CLI uses [qmd](https://github.com/nicholasgriffintn/qmd) for indexing and retrieval:

- **BM25 SDK path** for location and general queries (fast, ~40ms warm)
- **Hybrid SDK path** (BM25 + vector, pre-expanded, no rerank) for rationale queries (~45ms warm)
- **qmd CLI** retained only for admin commands (`qmd-update`, `qmd-embed`, `qmd-status`)

```bash
wiki qmd-update          # re-index vault
wiki qmd-embed           # generate embeddings
wiki qmd-status          # index health
```

<details>
<summary><strong>Benchmarking</strong></summary>

Use an isolated index to avoid polluting your main state:

```bash
QMD_INDEX_NAME=wiki-forge-bench bun src/index.ts qmd-setup
bun run bench:qmd
```

The harness measures BM25, vector, expand-query, and structured variants plus cold/warm latency for `wiki query` and `wiki ask`.

</details>

---

## Testing

```bash
bun test
```

---

## License

MIT
