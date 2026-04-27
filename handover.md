# Desloppify 90+ Handover — knowledge-wiki-system

Date: 2026-04-24

## Current state

- `review.md` exists and approves the WIKI-FORGE-203 cleanup/review patch.
- Working tree still has the WIKI-FORGE-203 changes plus `review.md` and this handover.
- `bun run check` passed.
- `bun test --timeout 10000` ran until the 120s harness timeout; all observed tests were passing, including the changed-area suites.
- `.desloppify/reports/latest.delta.json` shows no regression from the current patch:
  - base findings: 1132
  - head findings: 1132
  - added: 0
  - resolved: 0
  - worsened: 0
  - improved: 0

## Desloppify baseline

From `.desloppify/reports/latest.findings.json` / `latest.report.md`:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 348 |
| Medium | 725 |
| Low | 59 |

Category summary:

| Category | Count | Fixable |
| --- | ---: | ---: |
| ai-slop | 682 | 682 |
| dead-code | 341 | 341 |
| defensive-programming | 60 | 8 |
| test-quality | 32 | 0 |
| complexity | 12 | 0 |
| runtime-validation | 3 | 0 |
| async-correctness | 1 | 0 |
| inconsistency | 1 | 0 |

Top rules:

| Rule | Count |
| --- | ---: |
| `CONSOLE_LOG` | 675 |
| `DEAD_EXPORT` | 311 |
| `EMPTY_ARRAY_FALLBACK` | 49 |
| `WEAK_ASSERTION` | 32 |
| `DEAD_FILE` | 29 |
| `LONG_FILE` | 7 |
| `CATCH_RETURN_DEFAULT` | 5 |
| `JSON_PARSE_CAST` | 3 |

Top hotspots:

- `src/maintenance/sync/refresh.ts` — 39 findings
- `src/slice/forge/output.ts` — 35 findings
- `src/maintenance/closeout/maintain.ts` — 32 findings
- `src/session/resume/index.ts` — 31 findings
- `src/maintenance/closeout/index.ts` — 29 findings
- `src/session/handover/index.ts` — 29 findings
- `src/slice/forge/index.ts` — 28 findings
- `src/protocol/status/index.ts` — 26 findings
- `src/maintenance/doctor/discover.ts` — 25 findings
- `src/hierarchy/projection/summary.ts` — 24 findings

## Important triage boundary

Do **not** blindly apply all dead-code fixes.

The repo has many command entrypoints, public barrels, smoke-test surfaces, schema surfaces, and external workflow hooks. Desloppify/knip-style dead-code findings are useful leads, not deletion authority. Every `DEAD_FILE` and `DEAD_EXPORT` fix needs a reachability check through:

- `src/index.ts` CLI routing
- `package.json` bin/scripts
- public domain `index.ts` surfaces
- tests that import public surfaces indirectly
- installed `wiki` CLI usage
- skill/workflow references

## Recommended path to 90+

This should be treated as a dedicated quality campaign, not one giant patch. Suggested order:

### Phase 0 — Lock the current approved patch

1. Decide whether `review.md` and `handover.md` are meant to be committed or kept as session artifacts only.
2. Commit the WIKI-FORGE-203 patch once accepted.
3. Re-run:
   ```bash
   bun run check
   bun test
   desloppify scan .
   desloppify score .
   ```

### Phase 1 — Fast score wins: CLI output / console logging

Target: `CONSOLE_LOG` (675 findings, mostly medium).

Likely approach:

- Introduce or identify a small CLI output abstraction, e.g. `printLine`, `printJson`, `printError`, or domain-specific presenters.
- Replace direct `console.log` only where it is production command output.
- Avoid replacing test helper output or scripts where direct stdout is intentional unless desloppify scoring requires it and the replacement remains honest.
- Run command smoke tests after each module group.

Suggested batches:

1. `src/maintenance/**`
2. `src/session/**`
3. `src/slice/**`
4. `src/hierarchy/**`
5. `src/research/**` and `src/retrieval/**`
6. scripts/experiments last, because some console output may be intentional benchmark/reporting output.

Verification per batch:

```bash
bun run check
bun test tests/cli-smoke.test.ts tests/automation.test.ts tests/maintenance.test.ts
```

### Phase 2 — High-signal runtime safety

Target:

- `JSON_PARSE_CAST` (3)
- `CATCH_RETURN_DEFAULT` (5)
- `CATCH_LOG_CONTINUE` (1)
- `REDUNDANT_RETURN_AWAIT` / small async correctness items

These are safer than dead-code deletion and should be fixed with explicit validation/error semantics.

Expected work:

- Replace `JSON.parse(...) as T` with `unknown` parse + validator/type guard.
- Convert silent/defaulting catches into explicit typed errors or structured fallback reasons.
- Add tests for bad JSON and failed parse/error paths.

Verification:

```bash
bun run check
bun test tests/config-loader.test.ts tests/ax-optimizer-*.test.ts
```

### Phase 3 — Test quality findings

Target: `WEAK_ASSERTION` (32).

Approach:

- Strengthen assertions to behavior-specific expectations.
- Avoid brittle snapshots unless the output contract is intentionally exact.
- Prefer adding one meaningful assertion over broad test rewrites.

Verification:

```bash
bun run check
bun test
```

### Phase 4 — Defensive fallback cleanup

Target:

- `EMPTY_ARRAY_FALLBACK` (49)
- `EMPTY_OBJECT_FALLBACK` (3)

Approach:

- Triage each fallback into one of:
  - legitimate optional absence — keep and suppress/defer if needed;
  - invariant violation — replace with explicit error;
  - compatibility case — name it as such with a local helper and test.
- Do not mechanically remove `?? []`; some are correct for missing optional relationships.

Verification:

```bash
bun run check
bun test tests/auto-heal.test.ts tests/forge-status*.test.ts tests/maintenance.test.ts
```

### Phase 5 — Dead-code/dead-export campaign

Target:

- `DEAD_EXPORT` (311)
- `DEAD_FILE` (29)
- `DEAD_DEPENDENCY` / `UNLISTED_DEPENDENCY`

This is the riskiest phase. Split into sub-batches:

1. tests-only helpers and exports
2. experiment/ax-optimizer internals
3. legacy shim files that are provably not imported and not CLI/script entrypoints
4. public barrels only after a public API decision
5. dependencies last

For each candidate, prove safety with at least:

```bash
rg "<symbol-or-path>" .
bun run check
bun test
```

For files, also check `package.json`, `bin/wiki`, scripts, docs, and skill references.

## Suggested next command for a new agent/session

Use this as a pickup prompt:

```text
Continue the desloppify 90+ campaign for knowledge-wiki-system. Start from handover.md and review.md. Do not blindly delete dead code. First lock the current WIKI-FORGE-203 patch, then attack the highest-volume safe class: CONSOLE_LOG findings, in small module batches with tests after each batch. Preserve CLI behavior and public domain boundaries. Run bun run check and relevant tests before reporting.
```

## Current review verdict

WIKI-FORGE-203 review status: **APPROVED**.

The remaining work is not a blocker for the current patch; it is a larger quality campaign to drive the desloppify score toward 90+.
