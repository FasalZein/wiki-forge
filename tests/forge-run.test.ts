import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("forge run", () => {
  test("closes a clean slice after the pipeline runner split", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "runsplit"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "runsplit");
    expect(runWiki(["create-issue-slice", "runsplit", "pipeline split slice"], env).exitCode).toBe(0);

    const planPath = join(vault, "projects", "runsplit", "specs", "slices", "RUNSPLIT-001", "plan.md");
    const testPlanPath = join(vault, "projects", "runsplit", "specs", "slices", "RUNSPLIT-001", "test-plan.md");
    writeFileSync(
      planPath,
      "---\ntitle: RUNSPLIT-001 pipeline split slice\ntype: spec\nspec_kind: plan\nproject: runsplit\ntask_id: RUNSPLIT-001\nupdated: 2026-04-21\nstatus: current\n---\n\n# RUNSPLIT-001 pipeline split slice\n\n## Scope\n\n- keep forge run closing a clean slice\n",
      "utf8",
    );
    writeFileSync(
      testPlanPath,
      "---\ntitle: RUNSPLIT-001 pipeline split slice\ntype: spec\nspec_kind: test-plan\nproject: runsplit\ntask_id: RUNSPLIT-001\nupdated: 2026-04-21\nstatus: current\nverification_level: test-verified\n---\n\n# RUNSPLIT-001 pipeline split slice\n\n## Red Tests\n\n- [x] forge run should still close a clean slice.\n\n## Verification Commands\n\n```bash\nbun test tests/payments.test.ts\n```\n",
      "utf8",
    );
    expect(runWiki(["bind", "runsplit", "specs/slices/RUNSPLIT-001/index.md", "src/payments.ts"], env).exitCode).toBe(0);
    expect(runWiki(["forge", "start", "runsplit", "RUNSPLIT-001", "--agent", "codex", "--repo", repo], env).exitCode).toBe(0);

    const run = runWiki(["forge", "run", "runsplit", "RUNSPLIT-001", "--repo", repo, "--json"], env);
    expect(run.exitCode).toBe(0);

    const payload = JSON.parse(run.stdout.toString());
    expect(payload.check.ok).toBe(true);
    expect(payload.close.ok).toBe(true);
    expect(payload.check.steps.map((step: { id: string }) => step.id)).toEqual(["checkpoint", "lint-repo", "maintain", "update-index"]);
    expect(payload.close.steps.map((step: { id: string }) => step.id)).toEqual(["verify-slice", "closeout", "gate", "close-slice"]);
  });
});
