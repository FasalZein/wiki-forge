# Setup

## Quick Start

```bash
git clone https://github.com/FasalZein/wiki-forge.git
cd wiki-forge
./install.sh
```

The install script handles everything: bun, dependencies, global CLI linking, shell config, vault directory, and skill installation. By default it creates `~/Knowledge` if it does not exist yet.

## Manual Setup

### 1. Prerequisites

- [Bun](https://bun.sh) (the CLI runtime)
- [Node.js / npm](https://nodejs.org) (for `npx skills`)
- [Obsidian](https://obsidian.md) (optional, for vault UI)

### 2. Install the CLI

```bash
cd wiki-forge
bun install
bun link          # makes `wiki` available globally
```

### 3. Set your vault path

```bash
wiki setup-shell              # auto-detects shell, adds KNOWLEDGE_VAULT_ROOT=~/Knowledge
wiki setup-shell ~/my-vault   # or specify a custom path
source ~/.zshrc               # reload
```

Or manually add to your shell config:

```bash
export KNOWLEDGE_VAULT_ROOT="$HOME/Knowledge"
```

The CLI auto-detects `~/Knowledge` if the env var is unset.

### 4. Install skills

`forge` is a workflow orchestrator. It depends on companion skills, so install both the repo skills and the external workflow skills it chains into.

Repo skills:

```bash
npx skills@latest add ./skills/forge -g
npx skills@latest add ./skills/wiki -g
npx skills@latest add ./skills/prd-to-slices -g
```

Companion workflow skills from `mattpocock/skills`:

```bash
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
```

Or install the repo skills from GitHub:

```bash
npx skills@latest add FasalZein/wiki-forge/skills/forge -g
npx skills@latest add FasalZein/wiki-forge/skills/wiki -g
npx skills@latest add FasalZein/wiki-forge/skills/prd-to-slices -g
```

Verify:

```bash
npx skills list -g | grep -E "forge|wiki|prd-to-slices|grill-me|write-a-prd|tdd"
```

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

## Agent Setup

### For Claude Code

After installing skills, Claude Code automatically picks them up. Start any non-trivial feature session with:

```
/forge
```

`/forge` expects these companion skills to already be installed:
- `/grill-me`
- `/write-a-prd`
- `/prd-to-slices`
- `/tdd`
- `/wiki`

Or use individual skills directly:

```
/wiki          # CLI operations reference
/grill-me      # pressure-test the plan
/write-a-prd   # create the PRD
/prd-to-slices # break a PRD into backlog items
/tdd           # implement via red-green-refactor
```

### For Other Agents (Cursor, Codex, Kiro, etc.)

The `npx skills add -g --all` command installs skills for all supported agent harnesses. Each agent loads them from `~/.agents/skills/`.

### Agent Onboarding Prompt

Paste this into any agent session to get started on a project:

```
I need to onboard a project into the wiki. Here's what to do:

1. Run: wiki scaffold-project <project-name>
2. Run: wiki onboard-plan <project-name> --repo <path-to-repo> --write
3. Read the generated onboarding plan at projects/<project-name>/specs/onboarding-plan.md
4. Set repo: and code_paths: in projects/<project-name>/_summary.md
5. Run: wiki discover <project-name> --tree
6. For each module candidate, read the code and run:
   wiki create-module <project-name> <module> --source <paths...>
7. Fill in each module spec from the code
8. Run: wiki lint <project-name>
9. Run: wiki update-index <project-name> --write

Use /forge for the full SDLC workflow when building features.
Use /wiki for CLI reference.
```

### Human Onboarding

If you prefer to drive the process yourself:

```bash
# 1. Scaffold
wiki scaffold-project my-app
wiki onboard-plan my-app --repo ~/Dev/my-app --write

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

Run `bun link` from the wiki-forge directory, then `source ~/.zshrc`.

### `KNOWLEDGE_VAULT_ROOT not set`

Run `wiki setup-shell` or manually export it. The CLI also auto-detects `~/Knowledge`.

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
npx skills@latest add ./skills/forge -g
npx skills@latest add mattpocock/skills/grill-me -g
npx skills@latest add mattpocock/skills/write-a-prd -g
npx skills@latest add mattpocock/skills/tdd -g
```
