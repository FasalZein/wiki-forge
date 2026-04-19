import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectTaskDocState } from "../src/hierarchy";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupPassingRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("task doc readiness", () => {
  test("detectTaskDocState requires status ready even when the body is filled", async () => {
    const { vault } = setupPassingRepo();
    const docPath = join(vault, "draft-plan.md");
    writeFileSync(
      docPath,
      "---\ntitle: Draft Plan\ntype: spec\nspec_kind: plan\nproject: demo\ntask_id: DEMO-001\nupdated: 2026-04-19\nstatus: draft\n---\n\n# Draft Plan\n\n## Scope\n\n- finish implementation\n\n## Acceptance Criteria\n\n- [ ] covered\n",
      "utf8",
    );

    expect(await detectTaskDocState(docPath)).toBe("incomplete");

    writeFileSync(docPath, readFileSync(docPath, "utf8").replace("status: draft", "status: ready"), "utf8");
    expect(await detectTaskDocState(docPath)).toBe("ready");
  });

  test("forge status keeps filled draft docs out of ready state", () => {
    const { vault, repo } = setupPassingRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "wf153"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "wf153");
    expect(runWiki(["create-issue-slice", "wf153", "readiness slice"], env).exitCode).toBe(0);

    const sliceDir = join(vault, "projects", "wf153", "specs", "slices", "WF153-001");
    writeFileSync(
      join(sliceDir, "plan.md"),
      "---\ntitle: WF153-001\ntype: spec\nspec_kind: plan\nproject: wf153\ntask_id: WF153-001\nupdated: 2026-04-19\nstatus: draft\n---\n\n# plan\n\n## Scope\n\n- finish implementation\n\n## Acceptance Criteria\n\n- [ ] done\n",
      "utf8",
    );
    writeFileSync(
      join(sliceDir, "test-plan.md"),
      "---\ntitle: WF153-001\ntype: spec\nspec_kind: test-plan\nproject: wf153\ntask_id: WF153-001\nupdated: 2026-04-19\nstatus: draft\nverification_commands:\n  - command: bun test\n---\n\n# test-plan\n\n## Red Tests\n\n- [x] covered\n\n## Verification Commands\n\n```bash\nbun test\n```\n",
      "utf8",
    );

    const status = runWiki(["forge", "status", "wf153", "WF153-001", "--json"], env);
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout.toString());
    expect(payload.planStatus).toBe("incomplete");
    expect(payload.testPlanStatus).toBe("incomplete");
    expect(payload.triage.kind).toBe("needs-research");
  });
});
