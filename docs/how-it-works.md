# How wiki-forge works

wiki-forge has two installable layers that share one `wiki` CLI.

- **Wiki** is the second-brain layer. It stores durable markdown in the Knowledge vault, indexes it with QMD, and answers questions with cited sources.
- **Forge** is optional. It adds a software-delivery workflow over the wiki: planning, PRDs, slices, TDD evidence, targeted verification, review, close, and handover.

There is no separate Forge binary. A wiki-only install gets the wiki layer. A full install gets wiki plus the Forge workflow skills.

## Wiki path: store and retrieve knowledge

1. Create or choose a vault, normally `~/Knowledge`.
2. Scaffold or onboard a project:

   ```bash
   wiki scaffold-project my-app
   wiki onboard my-app --repo ~/Dev/my-app
   ```

3. File knowledge into the vault:

   ```bash
   wiki note my-app "important context"
   wiki research file my-app "auth provider comparison"
   wiki verify-page my-app modules/auth/spec code-verified
   ```

4. Keep retrieval current:

   ```bash
   wiki qmd-update
   wiki qmd-embed
   wiki qmd-status
   ```

5. Ask with citations:

   ```bash
   wiki ask my-app "where is token refresh implemented?"
   wiki query "why did we choose qmd?"
   wiki search "rate limiter"
   ```

QMD readiness target before trusting semantic retrieval:

```text
Needs embedding: 0
Vector index: yes
```

If embeddings are incomplete, `wiki ask` avoids vector retrieval and falls back to safer lexical retrieval.

## Forge path: follow the next command

Forge exists so agents do not have to guess lifecycle steps.

Start each implementation session with:

```bash
wiki resume my-app --repo ~/Dev/my-app --base main
wiki forge next my-app --repo ~/Dev/my-app --json
```

Then follow the returned `nextCommand`. Examples:

```json
{
  "nextAction": "release-draft-slice",
  "nextCommand": "wiki forge release my-app MY-APP-001"
}
```

or:

```json
{
  "nextAction": "start-ready-slice",
  "nextCommand": "wiki forge start my-app MY-APP-001"
}
```

For closeout, Forge requires explicit evidence:

```bash
wiki forge tdd cycle my-app MY-APP-001 --test tests/foo.test.ts --red-command "bun test tests/foo.test.ts" --green-command "bun test tests/foo.test.ts" --note "red failed before implementation; green passes after"
wiki forge evidence my-app MY-APP-001 verify --command "bun test tests/foo.test.ts && bun run check"
wiki forge review record my-app MY-APP-001 --verdict approved --reviewer codex
wiki forge run my-app MY-APP-001 --repo ~/Dev/my-app
```

Rules of thumb:

- Use `wiki forge next` to pick the next lifecycle action.
- Use `wiki forge status <project> <slice>` to debug one slice.
- Use `wiki checkpoint` and `wiki maintain` for freshness/repair, not lifecycle close.
- Use `wiki resume` for context only; if it is stale, re-anchor with `wiki forge next` and `wiki checkpoint`.

## Install modes

```bash
bun run sync:wiki                                             # wiki-only: CLI, QMD, /wiki skill
bun run sync:full                                             # full: wiki + Forge workflow skills + desloppify companion
bun run sync:local -- --install-set wiki-only --skip-skills   # CLI + QMD only
```

The installer exposes the same split:

```bash
./install.sh --wiki-only
./install.sh --full
./install.sh --wiki-only --skip-skills  # CLI + QMD only; no agent skills yet
```

## Vault ownership

Project knowledge belongs in the Knowledge vault, not the repo.

Allowed repo markdown is intentionally narrow:

- `README.md`
- `CHANGELOG.md`
- `AGENTS.md`
- `CLAUDE.md`
- `SETUP.md`
- `skills/**.md`

Architecture notes, PRDs, slice plans, handovers, research, and generated project views belong under `~/Knowledge/projects/<project>/`.

## Readiness smoke checks

Use these before relying on a fresh install:

```bash
wiki qmd-update
wiki qmd-embed
wiki qmd-status
wiki ask my-app "what is this project?"
wiki forge next my-app --repo ~/Dev/my-app --json
```

A healthy developer workflow has:

- QMD `Needs embedding: 0`
- `wiki ask` answers with cited vault sources
- `wiki forge next --json` returns a concrete `nextCommand`, or clearly says no slice exists and planning is needed
