---
name: wiki
description: >
  Second brain for any knowledge work: capture, retrieval, verification, research, and drift detection.
  Applies to code projects, research topics, hobbies, journals — anything you want an agent to remember and keep honest.
  Use the `wiki` CLI for scaffolding, linting, retrieval, drift detection, verification, and filing research.
  For SDLC workflow policy (features, PRDs, slices, TDD, closeout), use the `forge` skill.
---

# Wiki

> Scope: memory, retrieval, verification, research filing, and freshness repair. For active implementation threads, load `/forge`.

## Router

Choose the smallest fitting surface.

- retrieval or project Q&A: `wiki ask`, `wiki search`, `wiki query`
- knowledge refresh or freshness repair: `wiki checkpoint`, `wiki maintain`, `wiki verify-page`
- research filing: `wiki research ...`
- tracked slice delivery or phase steering: leave `/wiki` and load `/forge`

If the task is really “do the next slice”, you are on the wrong skill.

## Command Authority

When maintenance/retrieval surfaces disagree, do not guess. Use this order:

1. `wiki checkpoint` = current freshness truth
2. `wiki maintain` = repair/reconciliation plan
3. `wiki resume` = context summary only; may include historical notes

Practical rule:

- if `checkpoint` is clean, treat freshness as clean even if `resume` still prints stale-looking historical context
- if `maintain` says no changed files / no impacted pages, that is compatible with a clean checkpoint; prefer the checkpoint result for current stale/not-stale truth

## Main Commands

Use the smallest fitting command:

| Need | Command |
|---|---|
| default maintenance entry point | `wiki maintain <project> --base <rev>` |
| git-independent freshness truth | `wiki checkpoint <project> --repo <path>` |
| git-based reconciliation | `wiki refresh-from-git <project> --repo <path> --base <rev>` |
| accept reviewed impact as current | `wiki acknowledge-impact <project> <page...> --repo <path>` |
| update verification after a real content change | `wiki verify-page <project> <page> <level>` |
| repair `source_paths` | `wiki bind <project> <page> <source-path...>` |
| compact review surface | `wiki closeout <project> --repo <path> --base <rev>` |
| completion gate | `wiki gate <project> --repo <path> --base <rev>` |
| file project research | `wiki research file <topic> [--project <project>] <title>` |
| hand accepted conclusions into project truth | `wiki research distill <research-page> <projects/<project>/decisions|projects/<project>/architecture/domain-language>` |
| bridge accepted research into a tracked slice | `wiki research adopt <research-page> --project <project> --slice <slice-id>` |
| project Q&A | `wiki ask <project> <question>` |
| resume session context | `wiki resume <project> --repo <path> --base <rev>` |

SDLC scaffolds remain on the `wiki` CLI but are part of the forge workflow layer and are documented in the `forge` skill, not here.

## Generated/derived pages:

- project hub pages such as `projects/<project>/_summary.md` are derived knowledge surfaces
- navigation/index pages are also derived
- if one of these is stale, prefer `wiki sync` / `wiki maintain` first
- do not manually edit generated sections unless the command surface clearly leaves that section authored

Verification levels (ascending): `scaffold` -> `inferred` -> `code-verified` -> `runtime-verified` -> `test-verified`.
Demotion state: `stale`.

## Refresh-Only Flow

Use this when implementation decisions are already made and you are only refreshing the knowledge layer.

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

## Freshness Repair Path

Rule: prefer canonical reconciliation commands over manual markdown edits when the issue is freshness metadata, accepted impact, or source binding.

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
2. `wiki maintain <project> --repo <path> --base <rev>`
3. choose one repair branch:
   - reviewed-but-still-correct pages: `wiki acknowledge-impact <project> <page...> --repo <path>`
   - reconcile that acceptance against git: `wiki refresh-from-git <project> --repo <path> --base <rev>`
   - real content drift: update the page, then `wiki verify-page <project> <page> <level>`
   - broad or wrong bindings: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`

Do not hand-edit freshness metadata.

## Research Filing

Use `/research` for the investigation itself. Use `wiki research ...` for filing and handoff.

Compact lifecycle:

1. `wiki research file <topic> [--project <project>] <title>`
2. `wiki research ingest <topic> <source>`
3. `wiki research status [topic]`
4. `wiki research distill <research-page> <projects/...>`
5. if the research unblocks a tracked slice: `wiki research adopt <research-page> --project <project> --slice <slice-id>`

Distill updates project truth targets. Adopt bridges that evidence into forge-visible slice workflow.

## Debug Playbook

Use this only when freshness output disagrees:

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
2. `wiki maintain <project> --repo <path> --base <rev>`
3. `wiki resume <project> --repo <path> --base <rev>`

Treat `resume` as context only, not as the authority for current staleness.

If the disagreement is really about slice workflow state, leave `/wiki` and switch to `/forge`.

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
