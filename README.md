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
npm rebuild -g @tobilu/qmd
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
wiki closeout my-app --repo ~/Dev/my-app --base main       # compact refresh/drift/lint/gate review
wiki bind my-app modules/auth/spec src/auth/               # replace source_paths
wiki bind my-app modules/auth/spec --mode merge src/new.ts # append normalized unique source_paths
```

### Quality Gates

Every closeout runs through lint, semantic lint, and a pass/fail gate.

```bash
wiki lint my-app                                           # structural: frontmatter, wikilinks, headings
wiki lint-semantic my-app                                  # semantic: orphans, dead-ends, placeholders
wiki doctor my-app                                         # health score (0-100) + prioritized actions
wiki gate my-app --repo ~/Dev/my-app --base main           # pass/fail — blocks on missing tests
wiki gate my-app --repo ~/Dev/my-app --base main --structural-refactor  # allow zero-behavior-change refactors with parity checks
```

### Retrieval and Search

Intent-aware retrieval — BM25 for location queries, hybrid BM25+vector for rationale queries.

```bash
wiki search "auth middleware"                              # full-text search
wiki query "how does token refresh work"                   # intent-routed retrieval
wiki ask my-app "where is the rate limiter"                # compact project-scoped Q&A with citations
wiki ask my-app --verbose "where is the rate limiter"      # include routing + source sections
wiki file-answer my-app "how does caching work"            # save answer brief for compounding
```

### Research Layer

File evidence, scaffold topics, ingest sources, and audit quality — all traceable in the vault.

```bash
wiki research file my-app "auth provider comparison"       # file a research note
wiki research scaffold "state management"                  # create topic container
wiki research ingest "state management" ./notes.md         # seed from existing findings
wiki research status                                       # coverage + health summary
wiki research lint                                         # check evidence freshness
wiki research audit                                        # dead links + influenced_by coverage
wiki source ingest https://example.com/article             # raw source -> raw/ + linked summary
```

### Planning and Backlog

Features, PRDs, standalone planning docs, and vertical slices with task-scoped spec hubs — zero API calls.

```bash
wiki create-feature my-app "user onboarding"               # -> specs/features/FEAT-001-user-onboarding.md
wiki create-prd my-app --feature FEAT-001 "email signup"   # -> specs/prds/PRD-001-email-signup.md
wiki create-plan my-app "rollout checklist"                # -> specs/plan-rollout-checklist.md
wiki create-test-plan my-app "rollout checklist"           # -> specs/test-plan-rollout-checklist.md
wiki create-issue-slice my-app "email verification" --prd PRD-001 --assignee Codex --source src/auth.ts  # owner + explicit slice bindings
# optional: add agents: [Codex, Claude, pi] to _summary.md frontmatter to validate assignees
wiki backlog my-app --assignee Codex                      # list tracked tasks for one agent
wiki next my-app                                          # pick the active or next ready slice
wiki verify-slice my-app MY-APP-001 --repo ~/Dev/my-app  # run bash/sh code fences from slice test-plan.md
wiki export-prompt my-app MY-APP-001 --agent pi          # print a self-contained execution prompt
wiki resume my-app --repo ~/Dev/my-app --base main       # pick up an interrupted session fast
wiki close-slice my-app MY-APP-001 --repo ~/Dev/my-app --base main
```

`create-plan` and `create-test-plan` stay visible under `specs/index.md` as planning docs.

Use `depends_on` in slice frontmatter to block a slice until prerequisite slices move to `Done`:

```yaml
depends_on:
  - MY-APP-001
```

### Agent Coordination

```bash
wiki handover my-app --repo ~/Dev/my-app --base main      # backlog + git + dirty state handoff
wiki claim my-app MY-APP-001 --agent worker-1             # detect overlapping source_paths before claiming
wiki note my-app "left off at parser" --slice MY-APP-001 # durable agent-to-agent note in log.md
```

### Automation and CI

```bash
wiki commit-check my-app --repo ~/Dev/my-app              # staged-file freshness check for local commits
wiki install-git-hook my-app --repo ~/Dev/my-app          # writes a pre-commit hook that runs commit-check
wiki refresh-on-merge my-app --repo ~/Dev/my-app --base main --verbose
wiki dependency-graph my-app --write                       # writes verification/dependency-graph.canvas
```

Use `--verbose` when you want expanded human-readable detail. Keep default text output compact, and prefer `--json` for CI or agent chaining.

### Navigation and Index

```bash
wiki summary my-app                                        # one-shot project overview
wiki update-index my-app --write                           # regenerate spec indexes + derived relationship sections
wiki log                                                   # chronological operation log
```

`update-index` refreshes feature/PRD/slice lineage sections, module/freeform-zone planning links from `source_paths`, and the generated spec family indexes.

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

These are separate concerns. The wiki is the knowledge store. Research is evidence. Forge is the software-development workflow layer over that memory.

### Verification Levels

Every wiki page has a verification level that tracks how current it is:

```
scaffold  ->  inferred  ->  code-verified  ->  runtime-verified  ->  test-verified
```

When source code changes after verification, `drift-check` demotes the page to `stale`. Stale pages get flagged, not trusted.

### Mandatory Closeout Sequence

Every workflow — feature, bug fix, slicing, maintenance — ends with the same sequence:

```bash
# 1. Update impacted wiki pages from code (manual step)

# 2. Re-verify updated pages
wiki verify-page <project> <page> code-verified

# 3. Run the compact closeout wrapper
wiki closeout <project> --repo <path> --base <rev>
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
- planning lineage (`feature -> PRD -> slice`) comes from metadata (`feature_id`, `prd_id`, `parent_feature`, `parent_prd`)
- `create-issue-slice --prd <PRD-ID>` also auto-binds the new slice hub/plan/test-plan to the parent PRD's `source_paths` when they already exist, unless `--source <path...>` overrides them explicitly
- module/freeform-zone linkage comes from `source_paths` overlap
- standalone `create-plan` / `create-test-plan` docs stay listed under `specs/index.md`
- `wiki update-index <project> --write` regenerates those derived sections across spec pages, modules, and freeform project zones

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

`/research` is also required for full forge chaining. Install your agent's research skill separately if it is not already available.

### Skill Reference

| Skill | Invoke | What it does | When to use |
|-------|--------|-------------|-------------|
| **wiki** | `/wiki` | Knowledge-layer operations: research, retrieval, maintenance, drift, verification, gates | When no non-trivial product behavior is being planned or changed |
| **forge** | `/forge` | Software-development workflow: research -> grill -> PRD -> slices -> TDD -> verify | Non-trivial implementation work, new features, cross-module changes, or existing slice continuation |
| **prd-to-slices** | `/prd-to-slices` | Breaks a PRD into tracked vertical slices in the wiki backlog | After writing a PRD, before implementation |
| **grill-me** | `/grill-me` | Stress-tests a plan before committing to it | Before writing a PRD |
| **write-a-prd** | `/write-a-prd` | Captures problem, scope, modules, acceptance criteria | When you need formal project intent |
| **tdd** | `/tdd` | Red-green-refactor for each slice | During implementation |

### When to Use What

| Task | Workflow |
|------|----------|
| Knowledge maintenance / verification / retrieval | `/wiki` |
| Research-only work | `/wiki` + `/research` when external investigation is needed |
| Research capture | `/research` + `wiki research file` |
| Small code fix (< 50 lines) | `/tdd` + `/wiki` |
| Wiki / note cleanup | `/wiki` + `/obsidian-markdown` |
| Repo exploration | `wiki maintain` |
| New feature, workflow, or cross-module change | `/forge` (full pipeline) |
| Continue an existing PRD/slice thread | `/forge` |

---

## Wiki vs Forge

Assume a skill-capable harness can use both.
The real question is which layer the task belongs to.

Use **`/wiki`** for:
- research filing, audit, and status
- retrieval and project Q&A
- refresh, drift, verify, lint, gate, and closeout
- wiki formatting, vault cleanup, onboarding, and navigation
- research-only work that does not yet commit to implementation

Use **`/forge`** for:
- non-trivial implementation work
- new features and workflows
- cross-module changes
- performance/refactor work with tradeoffs
- existing PRD/slice continuation
- research when it is phase 1 of a larger implementation effort

Rule of thumb:
- changing product/runtime behavior -> `/forge`
- researching, retrieving, documenting, or verifying without active product changes -> `/wiki`

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
# update impacted pages
wiki verify-page my-app <page> code-verified
wiki closeout my-app --repo ~/Dev/my-app --base main
```

---

## Guardrails

- **Wiki vault is the knowledge store.** Agents write documentation to `~/Knowledge`, not to project repos.
- **Code is the source of truth.** Wiki pages compile from code, never the other way around.
- **No wiki-style docs in project repos.** Architecture docs, module specs, research — all go to the vault. Allowed repo markdown: `README.md`, `CHANGELOG.md`, `AGENTS.md`, `SETUP.md`, and `skills/*/SKILL.md`.
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
- **qmd SDK + Bun wrapper** now back the admin/indexing flow too (`qmd-setup`, `qmd-update`, `qmd-embed`, `qmd-status`), so wiki-forge no longer depends on a separately working global qmd CLI for maintenance
- **slice workflow** now supports assignees, prompt export, resume views, backlog filtering, and structural-refactor gate exceptions for clean handoffs across Codex, Claude, and pi

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
# bench:qmd uses scripts/qmd-cli.ts so Bun loads Homebrew SQLite before qmd CLI startup
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
