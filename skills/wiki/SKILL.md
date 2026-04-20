---
name: wiki
description: >
  Second brain for any knowledge work: capture, retrieval, verification, research, and drift detection.
  Applies to code projects, research topics, hobbies, journals — anything you want an agent to remember and keep honest.
  Use the `wiki` CLI for scaffolding, linting, retrieval, drift detection, verification, and filing research.
  For SDLC workflow policy (features, PRDs, slices, TDD, closeout), use the `forge` skill.
---

# Wiki

> **Scope:** memory, retrieval, verification, research filing, drift. For active implementation threads, load `/forge`.

The wiki is compiled memory. Sources of truth live outside it — code, filed research, and primary documents. Agents keep the markdown honest as those sources change.

## Protocol Start Checklist

Shared with `/forge`. See the forge skill for the full checklist.

Quick reference:
1. Check repo `AGENTS.md` / `CLAUDE.md` managed block.
2. Run `wiki resume <project> --repo <path> --base <rev>` when resuming.
3. When delegating, explicitly load `/wiki` in the sub-agent prompt.

Skip for pure read-only retrieval.

## Behavioral Guardrails

Defined in the forge skill. Apply to all wiki sessions. Load `/forge` for the full text.

## Use Wiki For

- maintenance, drift, freshness, verification
- retrieval and project Q&A
- research filing and audit
- onboarding and knowledge scaffolding
- protocol sync / audit
- navigation/index refresh

Escalate to `/forge` for non-trivial implementation, active slice work, or anything that is really “do the next slice”.

## Command Authority

When maintenance/retrieval surfaces disagree, do not guess. Use this order:

1. `wiki checkpoint` = current freshness truth
2. `wiki maintain` = repair/reconciliation plan
3. `wiki resume` = context summary only; may include historical notes

Practical rule:
- if `checkpoint` is clean, treat freshness as clean even if `resume` still prints stale-looking historical context
- if `maintain` says no changed files / no impacted pages, that is compatible with a clean checkpoint; prefer the checkpoint result for current stale/not-stale truth

## Main Commands

Use the smallest fitting surface.

| Need | Command |
|---|---|
| Default maintenance entry point | `wiki maintain <project> --base <rev>` |
| Report-first reconciliation | `wiki sync <project> [--write]` |
| Git-independent freshness check | `wiki checkpoint <project> --repo <path>` |
| Re-verify changed pages | `wiki verify-page <project> <page> <level>` |
| Compact review surface | `wiki closeout <project> --repo <path> --base <rev>` |
| Pass/fail completion gate | `wiki gate <project> --repo <path> --base <rev>` |
| Refresh navigation | `wiki update-index <project> --write` |
| Sync repo protocol files | `wiki protocol sync <project> --repo <path>` |
| Audit repo protocol files | `wiki protocol audit <project> --repo <path>` |
| File project research | `wiki research file <topic> [--project <project>] <title>` |
| Project Q&A | `wiki ask <project> [--verbose] <question>` |
| Resume session | `wiki resume <project> --repo <path> --base <rev>` |
| User-invoked handover | `wiki handover <project> --repo <path> --base <rev>` |

SDLC scaffolds remain on the `wiki` CLI but are part of the forge workflow layer and are documented in the `forge` skill, not here. Use `wiki help` for the raw command list.

Generated/derived pages:
- project hub pages such as `projects/<project>/_summary.md` are derived knowledge surfaces
- navigation/index pages are also derived
- if one of these is stale, prefer `wiki sync` / `wiki maintain` first
- do not manually edit generated sections unless the command surface clearly leaves that section authored

Verification levels (ascending): `scaffold` → `inferred` → `code-verified` → `runtime-verified` → `test-verified`.
Demotion state: `stale`.

## Refresh-Only Flow

Use this when implementation decisions are already made and you are just refreshing the knowledge layer.

```text
1. wiki maintain <project> --base <rev>
2. wiki checkpoint <project> --repo <path>
3. update impacted pages from code / source material
4. wiki verify-page <project> <page> <level>
5. wiki update-index <project> --write   (if navigation changed)
6. wiki closeout <project> --repo <path> --base <rev>
7. wiki gate <project> --repo <path> --base <rev>
```

If this turns into active slice work, switch to `/forge`.

## Debug Playbook

Use this when freshness output disagrees:

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
   This answers whether pages are currently stale.
2. `wiki maintain <project> --repo <path> --base <rev>`
   This tells you what to repair or reconcile.
3. `wiki resume <project> --repo <path> --base <rev>`
   Treat as context only, not as the authority for current staleness.

If the disagreement is really about slice workflow state, leave `/wiki` and switch to `/forge`.

## Retrieval

```text
Quick lookup        -> read the file directly
Broad search        -> wiki search "..."
Hybrid retrieval    -> wiki query "..."
Project Q&A         -> wiki ask <project> "..."
Save an answer      -> wiki file-answer <project> "..."
Resume context      -> wiki resume <project> --repo <path> --base <rev>
```

## Research Filing

Use `/research` for the investigation itself.
Use `wiki research ...` to file and audit the results.

Core commands:
- `wiki research file <topic> [--project <project>] <title>`
- `wiki research scaffold <topic>`
- `wiki research ingest <topic> <source>`
- `wiki research distill <research-page> <projects/...>`
- `wiki source ingest <path-or-url>`
- `wiki research lint [topic]`
- `wiki research audit [topic]`

Compact lifecycle:
- capture evidence with `wiki research file|ingest|source ingest`
- inspect backlog and verification pressure with `wiki research status`
- verify link hygiene and influence targets with `wiki research audit`
- hand accepted conclusions into project truth with `wiki research distill <research-page> <projects/...>`

## Operating Guidelines

- Never create extra wiki-style `.md` docs inside project repos beyond the allowed set.
- Use `wiki protocol sync <project> --repo <path>` for managed repo instruction blocks.
- `wiki protocol sync` updates protocol files only; it does not refresh installed skills.
- After editing `skills/*/SKILL.md`, run `bun run sync:local` and restart the agent session. Use `bun run sync:local -- --audit` when you want to check whether installed repo-skill copies have drifted.
- After fixing behavior, validate both the repo-local/dev CLI path and the installed/synced binary path. Do not assume repo tests alone prove installed-agent parity.
- Prefer Obsidian-flavored markdown when editing vault pages.
- Bind source paths early so drift detection can see the page.
- Set `repo:` in `_summary.md` for code projects or pass `--repo <path>`.
- Use `wiki maintain` as the default maintenance entry point.
- Verify after updating.
- `wiki handover` is user-invoked only.
- Do not invent CLI features or ad hoc document layouts.

## Data Planes

The CLI mainly operates on:
- frontmatter
- markdown body
- git history
- filesystem/globs

Think in those planes when deciding whether a task is about authored truth, derived truth, or repo state.
