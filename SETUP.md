# Setup

## Quick Start

```bash
git clone https://github.com/FasalZein/wiki-forge.git
cd wiki-forge
./install.sh          # prompts for wiki-only vs full wiki+forge setup
# or:
./install.sh --wiki-only
./install.sh --full
./install.sh --wiki-only --skip-skills  # qmd only; install /wiki later if desired
```

The install script handles first-time bootstrap: bun, dependencies, qmd/skill sync, shell config, vault directory, and skill installation. By default it creates `~/Knowledge` if it does not exist yet.

If you are using an agent, give it this first:

```text
Read SETUP.md completely before running setup. Use wiki-only when I only want the second-brain layer. Use full when I want Wiki plus the Forge workflow skills. Do not write handover or project knowledge files into the repo; those belong in the Knowledge vault. After install, run wiki qmd-status and report whether Needs embedding is 0.
```

Install modes:

- `wiki-only`: installs only the `/wiki` second-brain layer
- `full`: installs `/wiki` and the repo-owned `/forge` workflow stack; external optional skills remain outside the repository
- `--skip-skills`: installs only qmd setup now; you can install agent skills later with `bun run sync:wiki` or `bun run sync:full`


## Forge operating rules

Wiki = memory; Forge = lifecycle; Kernel = truth; projections = help. Skills provide guidance, but CLI/kernel invariants enforce lifecycle truth.

For normal slice work, record TDD explicitly before closeout: `wiki forge tdd cycle ...` captures the failed red observation and later passing green observation with at least one same `--test` path. Forge does not silently infer TDD from passing tests.

Use targeted verification from the slice test plan plus `bun run check`. Run full `bun test` only for the production Forge release gate, not for normal per-slice closeout.

Forge migration is intentionally dry-run first: classify current vault documents, quarantine ambiguous lifecycle records, preserve source files, and write only to explicit Forge target paths during import.

## Manual Setup

### 1. Prerequisites

- [Bun](https://bun.sh) (the CLI runtime)
- [Node.js / npm](https://nodejs.org) (for `npx skills` and global `qmd`)
- [Obsidian](https://obsidian.md) (optional, for vault UI)
- macOS: Homebrew `sqlite` is recommended so Bun can use qmd SDK hybrid retrieval via `Database.setCustomSQLite()`

### 2. Install the CLI

```bash
cd wiki-forge
bun install
bun run sync:local
```

On macOS, also install Homebrew sqlite if you do not already have it:

```bash
brew install sqlite
```

### 3. Set your vault path

```bash
wiki setup-shell              # optional: pins KNOWLEDGE_VAULT_ROOT=~/Knowledge for shells that need an explicit override
wiki setup-shell ~/my-vault   # or specify a custom path
source ~/.zshrc               # reload
```

Or manually add to your shell config:

```bash
export KNOWLEDGE_VAULT_ROOT="$HOME/Knowledge"
```

The CLI defaults to `~/Knowledge` and creates the minimal vault shape on first use if no override or parent vault is detected.

### 4. Install skills

`sync:local` is the canonical install path for qmd and skills. It does not relink the global `wiki` CLI by default; use `bun run sync:link-cli` when you intentionally want the global CLI to point at this checkout. `sync:local` refreshes qmd, installs the selected repo-owned skill set discovered under `skills/*/SKILL.md`, and in `full` mode installs configured external companions without bundling them into this repository.

```bash
bun run sync:wiki                                             # wiki-only second-brain install set
bun run sync:full                                             # full wiki+forge install set
bun run sync:local -- --install-set wiki-only                 # equivalent explicit form
bun run sync:local -- --install-set wiki-only --skip-skills   # qmd only; no agent skills
```

Current full repo-owned skill set:

- `diagnose`
- `forge`
- `grill-with-docs`
- `handoff`
- `improve-codebase-architecture`
- `prd-to-slices`
- `tdd`
- `wiki`
- `write-a-prd`

External optional skills:

- `research` for external investigation and evidence gathering
- `prototype` for throwaway logic/UI exploration
- `desloppify` for final code-quality scanning

These remain external/on-demand skills. Do not re-add them under `skills/` as repo-owned bundled skills.

`wiki-only` installs just:

- `wiki`

If you want to install specific skills from your local checkout, use the repo-owned paths plus the external `desloppify` package:

```bash
npx skills add FasalZein/desloppify
npx skills@latest add ./skills/diagnose -g
npx skills@latest add ./skills/forge -g
npx skills@latest add ./skills/grill-with-docs -g
npx skills@latest add ./skills/handoff -g
npx skills@latest add ./skills/improve-codebase-architecture -g
npx skills@latest add ./skills/prd-to-slices -g
npx skills@latest add ./skills/tdd -g
npx skills@latest add ./skills/wiki -g
npx skills@latest add ./skills/write-a-prd -g
```

Or install them from GitHub:

```bash
npx skills add FasalZein/desloppify
npx skills@latest add FasalZein/wiki-forge/skills/diagnose -g
npx skills@latest add FasalZein/wiki-forge/skills/forge -g
npx skills@latest add FasalZein/wiki-forge/skills/grill-with-docs -g
npx skills@latest add FasalZein/wiki-forge/skills/handoff -g
npx skills@latest add FasalZein/wiki-forge/skills/improve-codebase-architecture -g
npx skills@latest add FasalZein/wiki-forge/skills/prd-to-slices -g
npx skills@latest add FasalZein/wiki-forge/skills/tdd -g
npx skills@latest add FasalZein/wiki-forge/skills/wiki -g
npx skills@latest add FasalZein/wiki-forge/skills/write-a-prd -g
```

Verify:

```bash
npx skills list -g | grep -E "desloppify|diagnose|forge|grill-with-docs|handoff|improve-codebase-architecture|prd-to-slices|tdd|wiki|write-a-prd"
```

### 5. Sync local updates

After pulling repo changes or editing `skills/*/SKILL.md`, run the install set you want to keep active:

```bash
bun run sync:wiki  # wiki-only
bun run sync:full  # wiki + forge workflow skills
```

That refreshes:
- the global `qmd` install plus native rebuild
- repo-owned skills discovered from `skills/*/SKILL.md`
- configured external workflow companions for the full install set

It does not relink the global `wiki` CLI by default. Run `bun run sync:link-cli` only when you intentionally want this checkout to own the global `wiki` command.

`bun run sync:local -- --with-companions` is still accepted for compatibility, but today the default `full` install already includes the external workflow companion set.

```bash
bun run sync:local -- --with-companions
```

You can audit a specific install set after syncing:

```bash
bun run sync:local -- --audit
bun run sync:local -- --install-set wiki-only --audit
```

After syncing skills, restart your agent session so it reloads the updated installed copies.

## Obsidian Setup

The wiki vault is an Obsidian vault. You can browse and edit pages in Obsidian alongside the CLI.

### Enable Obsidian CLI

Obsidian 1.8+ includes a built-in CLI. Enable it:

1. Open Obsidian
2. Go to **Settings → General**
3. Scroll to **CLI** and toggle it on
4. Restart your terminal

This lets the `wiki obsidian open <note>` command work, opening pages directly in Obsidian from the terminal.

### Recommended Obsidian Plugins

- **Dataview** — query frontmatter across the vault
- **Graph Analysis** — visualize module dependencies
- **Templater** — use the templates in `templates/`

### Vault Structure

When you open `~/Knowledge` in Obsidian, you'll see:

```
index.md                         # vault entry point
projects/<name>/                 # per-project documentation
  _summary.md                    # project overview + config
  backlog.md                     # task tracking
  modules/<mod>/spec.md          # module documentation
  specs/                         # PRDs, plans, test plans
research/                        # research artifacts
wiki/syntheses/                  # filed answer briefs
templates/                       # page templates
```

## How the pieces fit

See [docs/how-it-works.md](docs/how-it-works.md) for the end-to-end model:

- Wiki stores and retrieves durable project knowledge through markdown + QMD.
- Forge is optional and guides implementation by returning explicit `nextCommand` values.
- Health commands (`checkpoint`, `maintain`, `doctor`) inspect freshness and repair needs; they do not close lifecycle work.

## Agent Setup

### For Claude Code

After installing skills, Claude Code automatically picks them up. Start any non-trivial feature session with:

```
/forge
```

`/forge` expects the repo-owned workflow skills installed by `bun run sync:full`:
- `/diagnose`
- `/forge`
- `/grill-with-docs`
- `/handoff`
- `/write-a-prd`
- `/prd-to-slices`
- `/tdd`
- `/wiki`
- `/improve-codebase-architecture`

External optional skills such as `/research`, `/prototype`, and `/desloppify` can be loaded when the phase or task calls for them, but they are not repo-owned bundled skills.


Layer contract:

- `/wiki` stays the second-brain layer
- `/forge` stays the SDLC workflow layer
- `wiki-only` installs only the first layer
- `full` installs both layers without mixing their responsibilities

Or use individual skills directly:

```
/wiki          # CLI operations reference
/research      # investigate and file evidence
wiki forge plan <project> "feature name" --plan-answer-file <path>
# The Plan packet can include grill-with-docs context, PRD content, and initial slices.
/tdd           # implement via red-green-refactor
/improve-codebase-architecture # capture deeper refactor candidates
/desloppify    # final code-quality pass (installed externally)
```

### For Other Agents (Cursor, Codex, Kiro, etc.)

The `npx skills add -g --all` command installs skills for all supported agent harnesses. Each agent loads them from `~/.agents/skills/`.

### Agent Onboarding Prompt

Paste this into any agent session to get started on a project:

```text
First read this project's SETUP.md and docs/how-it-works.md. Then onboard the target project into wiki-forge. Keep project knowledge in the Knowledge vault, not in the repo.


1. Run: wiki scaffold-project <project-name>
2. Run: wiki onboard <project-name> --repo <path-to-repo>
3. Read the generated onboarding plan at projects/<project-name>/specs/onboarding-plan.md
4. Set repo: and code_paths: in projects/<project-name>/_summary.md
5. Optional: add orientation_scopes: [...] in projects/<project-name>/_summary.md for nested package/app instructions
6. Run: wiki discover <project-name> --tree
7. For each module candidate, read the code and run:
   wiki create-module <project-name> <module> --source <paths...>
8. Fill in each module spec from the code
9. Run: wiki sync <project-name> --repo <path-to-repo> --json
10. Run: wiki lint <project-name>
11. Run: wiki update-index <project-name> --write

Use /forge for the full SDLC workflow when building features.
Use /wiki for CLI reference.
After onboarding, run wiki qmd-update, wiki qmd-embed, and wiki qmd-status. Retrieval is ready when Needs embedding is 0.
```

### Human Onboarding

If you prefer to drive the process yourself:

```bash
# 1. Scaffold
wiki scaffold-project my-app
wiki onboard my-app --repo ~/Dev/my-app
wiki sync my-app --repo ~/Dev/my-app --json

# 2. Explore
wiki discover my-app --tree

# 3. Create modules
wiki create-module my-app auth --source src/auth/ src/routes/auth/
wiki create-module my-app payments --source src/payments/

# 4. Verify
wiki lint my-app
wiki doctor my-app

# 5. Maintain (run after code changes)
wiki maintain my-app
```

## Troubleshooting

### `wiki: command not found`

Run `bun run sync:local` from the wiki-forge directory, then `source ~/.zshrc`.

### Where is my vault?

Default is `~/Knowledge`; the CLI creates it on first use if no override or parent vault is detected. Set `KNOWLEDGE_VAULT_ROOT` only when you intentionally use a different vault. If the override points to a missing path, create that path or unset the override.

### `qmd` fails with `better-sqlite3` bindings errors

Rebuild the global qmd package so its native module matches your current Node install:

```bash
npm rebuild -g @tobilu/qmd
qmd --help
```

If it still fails, reinstall it cleanly:

```bash
npm uninstall -g @tobilu/qmd
npm install -g @tobilu/qmd@latest
npm rebuild -g @tobilu/qmd
```

### `qmd` search returns no results

```bash
wiki qmd-update    # re-index vault
wiki qmd-embed     # generate embeddings
```

### Obsidian CLI not working

Ensure you're on Obsidian 1.8+ and have enabled CLI in Settings → General. Restart your terminal after enabling.

### Skills not appearing in agent

```bash
npx skills list -g                  # verify installation
bun run sync:local
```

Then restart the agent session. Installed skills under `~/.agents/skills/` do not hot-reload into already running sessions.
