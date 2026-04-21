---
name: wiki
description: >
  Second brain for knowledge capture, retrieval, verification, research filing, and freshness repair.
  Use the `wiki` CLI for wiki-layer work only.
  For SDLC workflow policy, tracked slices, PRDs, implementation steering, and closeout flow, use the `forge` skill.
---

# Wiki

> Scope: memory, retrieval, verification, research filing, and freshness repair. For active implementation workflow, load `/forge`.

## Router

Choose the smallest fitting surface.

- retrieval or project Q&A: `wiki ask`, `wiki search`, `wiki query`
- freshness truth or repair: `wiki checkpoint`, `wiki maintain`, `wiki verify-page`, `wiki bind`
- research filing and handoff: `wiki research ...`
- tracked slice execution, phase control, or SDLC policy: leave `/wiki` and load `/forge`

If the task is really “do the next slice,” this is the wrong skill.

## Command Authority

When wiki surfaces disagree, do not infer current state from summaries. Use this order:

1. `wiki checkpoint` = current freshness truth
2. `wiki maintain` = repair and reconciliation guidance
3. `wiki resume` = convenience context only; may include historical or stale-looking notes

Practical rules:

- if `wiki checkpoint` is clean, treat freshness as clean even if `wiki resume` still shows older context
- if `wiki maintain` reports no changed files or no impacted pages, that can still coexist with historical-looking `wiki resume` output
- for current stale/not-stale decisions, prefer `wiki checkpoint`, then `wiki maintain`

## Main Commands

Use the smallest fitting command:

| Need | Command |
|---|---|
| default maintenance entry point | `wiki maintain <project> [--repo <path>] [--base <rev>]` |
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

SDLC scaffolds may exist on the `wiki` CLI, but their workflow policy belongs to `forge`, not here.

## Generated and Derived Pages

Treat generated or derived pages as command-owned surfaces.

- project hubs such as `projects/<project>/_summary.md` are generated or derived knowledge surfaces
- navigation, index, and rollup pages are also often generated
- if a generated page looks stale, prefer `wiki sync`, `wiki maintain`, or the relevant reconciler before editing markdown
- do not manually edit generated sections unless the command surface clearly leaves that portion authored by humans
- when in doubt, repair source bindings, freshness state, or upstream authored pages first

Verification levels (ascending): `scaffold` -> `inferred` -> `code-verified` -> `runtime-verified` -> `test-verified`.
Demotion state: `stale`.

## Refresh-Only Flow

Use this when implementation decisions are already made and you are only refreshing the wiki layer.

1. `wiki maintain <project> [--repo <path>] [--base <rev>]`
2. `wiki checkpoint <project> --repo <path>`
3. update impacted authored pages from code or source material
4. `wiki verify-page <project> <page> <level>`
5. `wiki update-index <project> --write` if navigation changed
6. `wiki closeout <project> --repo <path> --base <rev>`
7. `wiki gate <project> --repo <path> --base <rev>`

If the work becomes active slice execution, switch to `/forge`.

## Freshness Repair Path

Rule: prefer canonical reconciliation commands over manual markdown edits when the issue is freshness metadata, accepted impact, source binding, or generated outputs.

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
2. `wiki maintain <project> --repo <path> --base <rev>`
3. optionally scope before mutating pages:
   - `wiki sync <project> [--repo <path>] [--report-only]`
4. choose the repair branch that matches reality:
   - reviewed but still correct pages: `wiki acknowledge-impact <project> <page...> --repo <path>`
   - reconcile accepted impact against git: `wiki refresh-from-git <project> --repo <path> --base <rev>`
   - real content drift: update the authored page, then `wiki verify-page <project> <page> <level>`
   - broad or incorrect bindings: `wiki bind <project> <page> <source-path...> [--mode replace|merge]`

Do not hand-edit freshness metadata.

## Research Filing

Use `/research` for investigation. Use `wiki research ...` for filing and handoff.

1. `wiki research file <topic> [--project <project>] <title>`
2. `wiki research ingest <topic> <source>`
3. `wiki research status [topic]`
4. `wiki research distill <research-page> <projects/...>`
5. if the result unblocks a tracked slice: `wiki research adopt <research-page> --project <project> --slice <slice-id>`

Distill updates project truth. Adopt bridges accepted findings into forge-visible slice workflow.

## Debug Playbook

Use this only when freshness outputs disagree:

1. `wiki checkpoint <project> --repo <path> [--base <rev>]`
2. `wiki maintain <project> --repo <path> --base <rev>`
3. `wiki sync <project> [--repo <path>] [--report-only]`
4. `wiki resume <project> --repo <path> --base <rev>`

Treat `wiki resume` as context support, not as the source of current freshness truth.

If the disagreement is really about slice workflow state, leave `/wiki` and switch to `/forge`.

## Operating Guidelines

- Never create extra wiki-style `.md` docs inside project repos beyond the allowed set.
- Use `wiki protocol sync <project> --repo <path>` for managed repo instruction blocks.
- `wiki protocol sync` updates protocol files only; it does not refresh installed skills.
- After editing `skills/*/SKILL.md`, run `bun run sync:local`, then `bun run sync:local -- --audit`, then restart the agent session.
- Do not give `bun run sync:local` or restart the agent session guidance for normal wiki page maintenance; that guidance is only for skill edits.
- After behavior fixes, validate both the repo-local/dev CLI path and the installed or synced binary path.
- Prefer Obsidian-flavored markdown when editing vault pages.
- Bind source paths early so drift detection can see the page.
- Set `repo:` in `_summary.md` for code projects or pass `--repo <path>`.
- Use `wiki maintain` as the default maintenance entry point.
- Verify after updating.
- `wiki handover` is user-invoked only.
- Do not invent CLI features or ad hoc document layouts.
