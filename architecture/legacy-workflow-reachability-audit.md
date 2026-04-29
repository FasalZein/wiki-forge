# Legacy workflow reachability audit

Status: draft
Date: 2026-04-28

## Verdict

Forge now covers the lifecycle behavior worth keeping from legacy. What remains is mostly old command surfaces, projections, admin/read models, and tests that still exercise legacy internals.

Do **not** port legacy one-to-one. Focus on reachability, deletion, and keeping admin/view code non-authoritative.

## Covered by Forge

| Legacy area | Legacy command/module | Forge/Wiki replacement | Status |
| --- | --- | --- | --- |
| Backlog mutation | `wiki backlog`, `add-task`, `move-task`, `complete-task`, `src/hierarchy/backlog/commands.ts` | `wiki forge plan`, `wiki forge status`, `wiki forge next`, `wiki forge start`, `wiki forge close` | Replaced; commands quarantined |
| Slice claim/start | `wiki claim`, `wiki start-slice`, `src/slice/coordination/**`, `src/slice/lifecycle/start.ts` | `wiki forge start`, active-slice invariant | Replaced |
| Slice release | legacy claim reset behavior | `wiki forge release` | Replaced |
| Verification | `wiki verify-slice`, pipeline verify phase | `wiki forge evidence`, `wiki forge check` | Replaced |
| Review | legacy forge review evidence paths | `wiki forge review record`, review gate | Replaced |
| Close | `wiki close-slice`, lifecycle close | `wiki forge check`, `wiki forge close` | Replaced |
| Run/orchestration | `wiki pipeline`, `pipeline-reset`, `src/slice/pipeline/**` | `wiki forge run`, explicit evidence records | Replaced |
| Planning artifact creation | `create-feature`, `create-prd`, `create-plan`, `create-test-plan`, `create-issue-slice`, `start-feature`, `close-feature`, `start-prd`, `close-prd`, `src/hierarchy/planning/**`, `src/hierarchy/lifecycle/**` | `wiki forge plan` planning session + artifacts | Replaced enough for production |
| Resume/handover | legacy `session/handover`, `session/resume`, `session/next` | typed handover/resume/next/prompt packet | Replaced |
| Note/log | legacy `session/note`, `session/log` | typed project memory under `projects/<project>/memory/**` | Replaced |

## Not worth porting as lifecycle behavior

These legacy behaviors should be deleted or kept only as admin/read helpers. They should not become Forge truth again.

- Generated `backlog.md` as workflow state.
- Pipeline progress as lifecycle authority. ✅ deleted
- Specs-backed slice lifecycle under `projects/<project>/specs/**`.
- Hidden repair from maintenance commands.
- Ambiguous top-level `status`, `gate`, `closeout`.
- Feature/PRD lifecycle commands that mutate generated hierarchy projections.

## Remaining legacy surfaces

### Delete candidates after reachability tests pass

- `src/slice/forge/**` command handlers and legacy orchestration. ✅ public runtime now routes through stable `wiki forge ...`; public `wiki v1 ...` compatibility namespace deleted
- `src/slice/pipeline/**` runtime pipeline state machine. ✅ deleted
- `src/slice/lifecycle/**` start/close commands. ✅ legacy close command deleted; start command adapter removed, core remains temporarily for legacy forge/pipeline deletion
- `src/slice/coordination/**` claim commands. ✅ deleted
- `src/hierarchy/backlog/commands.ts` mutation commands.
- `src/hierarchy/lifecycle/start-*.ts` and `close-*.ts` lifecycle commands. ✅ command adapters deleted
- `src/hierarchy/planning/**` legacy PRD/plan/slice creation commands. ✅ public facade reduced to parser helpers; internal legacy creators remain only for legacy slice/forge deletion work
- `src/session/continuation/next.ts`, `handover`, `resume` command adapters once top-level routes no longer need them.

### Admin/read-model surfaces to keep temporarily

These still support dashboard, checkpoint, protocol status, or freshness tools. They are allowed only as non-authoritative views. Admin/view commands must not claim lifecycle authority and must not be advertised as replacements for Forge lifecycle commands.

- `src/hierarchy/backlog/collect.ts`
- `src/hierarchy/backlog/io.ts` readers/parsers only
- `src/slice/docs/**` readers
- `src/hierarchy/projection/**`
- `src/maintenance/**` admin/freshness collectors
- `src/protocol/status/**` read-only status/steering helpers

Guardrail: `tests/v1/admin-view-read-models.test.ts` verifies admin/view command registry entries are non-mutating, removed lifecycle commands stay out of full help, and the remaining legacy Forge compatibility module no longer carries dead plan mutators.

## Current blockers to deletion

1. Legacy command handlers still exist in implementation files, but root public barrels no longer export quarantined workflow commands:
   - `src/slice/index.ts`
   - `src/hierarchy/index.ts`
   - `src/session/index.ts`

2. Some maintenance/protocol/session modules still import legacy readers:
   - `src/session/handover/index.ts`
   - `src/session/resume/index.ts`
   - `src/maintenance/**`
   - `src/protocol/status/**`

3. Some tests intentionally exercise legacy internals:
   - `tests/pipeline*.test.ts`
   - `tests/forge-review-gate.test.ts`
   - `tests/forge-evidence-readers.test.ts`
   - `tests/planning.test.ts`
   - `tests/note.test.ts`

## Recommended deletion order

1. Add static guard that no normal runtime command imports legacy command barrels.
2. Remove/reduce legacy public barrels so command handlers are not importable by accident. ✅
3. Split legacy read helpers from legacy mutators.
4. Delete mutators first:
   - backlog mutation
   - feature/PRD lifecycle mutation
   - slice lifecycle mutation
   - pipeline runner
5. Keep read-model/admin helpers until dashboard/checkpoint/protocol status are either ported or explicitly accepted as non-authoritative.
6. Final promotion: remove `wiki v1 ...` aliases and compatibility re-exports.

## Answer to “have we covered everything?”

Yes for the core lifecycle and agent workflow. No for every old admin/view convenience command, and that is intentional. The missing old pieces are mostly projections and helper views; they should be kept non-authoritative or deleted rather than ported into Forge.
