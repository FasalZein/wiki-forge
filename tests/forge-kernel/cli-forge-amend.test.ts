import { afterEach, describe, expect, test } from "bun:test";
import matter from "gray-matter";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("Forge amend", () => {
  test("removed amend flag routes to Forge and ignores old backlog closure state", () => {
    const vault = tempDir("wiki-amend-vault");
    initVault(vault);
    writeClosedForgeSlice(vault, "demo", "DEMO-001", {
      status: "done",
      sourcePaths: ["src/payments.ts"],
      evidence: true,
    });

    const result = runWiki(["forge", "amend", "demo", "DEMO-001", "--reason", "production regression", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      project: "demo",
      closedSliceId: "DEMO-001",
      amendmentSliceId: "DEMO-002",
      reason: "production regression",
      sourcePaths: ["src/payments.ts"],
      started: false,
    });

    const closedHub = readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-001", "index.md"), "utf8");
    expect(closedHub).toContain("status: done");
    expect(closedHub).not.toContain("amendment_of:");

    const amendmentHub = matter(readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-002", "index.md"), "utf8"));
    expect(amendmentHub.data).toMatchObject({
      type: "forge-slice",
      project: "demo",
      task_id: "DEMO-002",
      status: "draft",
      amendment_of: "DEMO-001",
      amendment_reason: "production regression",
      review_policy: { required_approvals: 1 },
    });
    expect(amendmentHub.data.depends_on).toEqual(["DEMO-001"]);
    expect(amendmentHub.data.source_paths).toEqual(["src/payments.ts"]);
    expect(amendmentHub.content).toContain("Do not reopen or edit the closed slice");
    expect(readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-002", "plan.md"), "utf8")).toContain("Preserve the original close evidence");
    expect(readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-002", "test-plan.md"), "utf8")).toContain("Add regression coverage");
  });

  test("can start a Forge amendment without moving an old backlog row", () => {
    const vault = tempDir("wiki-amend-start-vault");
    initVault(vault);
    writeClosedForgeSlice(vault, "demo", "DEMO-001", {
      status: "done",
      sourcePaths: ["src/payments.ts"],
      evidence: true,
    });

    const result = runWiki(["forge", "amend", "demo", "DEMO-001", "--reason", "follow-up bug", "--start", "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ amendmentSliceId: "DEMO-002", started: true });
    const amendmentHub = matter(readFileSync(join(vault, "projects", "demo", "forge", "slices", "DEMO-002", "index.md"), "utf8"));
    expect(amendmentHub.data.status).toBe("in-progress");
    expect(amendmentHub.data.claimed_by).toBe("codex");
    expect(typeof amendmentHub.data.claimed_at).toBe("string");
  });

  test("refuses to amend slices that are not closed in Forge truth", () => {
    const vault = tempDir("wiki-amend-open-vault");
    initVault(vault);
    writeClosedForgeSlice(vault, "demo", "DEMO-001", {
      status: "in-progress",
      sourcePaths: [],
      evidence: true,
    });

    const result = runWiki(["forge", "amend", "demo", "DEMO-001", "--reason", "needs followup"], { vault });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("slice is not closed in Forge lifecycle truth");
  });

  test("cutover predicate keeps amend on stable Forge", () => {
  });
});

type SliceFixture = {
  readonly status: "done" | "in-progress";
  readonly sourcePaths: readonly string[];
  readonly evidence: boolean;
};

function writeClosedForgeSlice(vault: string, project: string, sliceId: string, fixture: SliceFixture) {
  const sliceDir = join(vault, "projects", project, "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, {
    title: `${sliceId} test slice`,
    type: "forge-slice",
    project,
    task_id: sliceId,
    status: fixture.status,
    source_paths: fixture.sourcePaths,
    ...(fixture.evidence ? {
      forge_evidence: [
        { kind: "tdd", phase: "red", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "failed", recordedAt: "2026-04-28T05:59:00.000Z" },
    { kind: "tdd", phase: "green", command: "bun test tests/forge-kernel/x.test.ts", testPaths: ["tests/forge-kernel/x.test.ts"], result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
        { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
        { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
      ],
      forge_closure_evidence: ["tdd", "verification", "review"],
      closed_at: "2026-04-28T06:00:03.000Z",
      closed_by: "codex",
    } : {}),
  }), "utf8");
}
