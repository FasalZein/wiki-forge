import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { shouldUseForgeStatus } from "../../src/forge/cutover";

const sliceId = "DEMO-001";

afterEach(() => cleanupTempPaths());

type SliceFixtureOptions = {
  readonly status: "draft" | "ready" | "in-progress" | "done";
  readonly evidence?: readonly Record<string, unknown>[];
  readonly extraFrontmatter?: Record<string, unknown>;
  readonly includeHostileLegacyProjection?: boolean;
};

function createVaultWithSlice(options: SliceFixtureOptions) {
  const vault = tempDir("wiki-status-slice-vault");
  initVault(vault);
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  const frontmatter: Record<string, unknown> = {
    title: `${sliceId} test slice`,
    type: "forge-slice",
    project: "demo",
    task_id: sliceId,
    status: options.status,
    parent_prd: "PRD-001",
    parent_feature: "FEAT-001",
    source_paths: ["src/demo.ts"],
    ...options.extraFrontmatter,
  };
  if (options.evidence?.length) frontmatter.forge_evidence = options.evidence;
  writeFileSync(join(sliceDir, "index.md"), matter.stringify(`# ${sliceId}\n`, frontmatter), "utf8");
  writeFileSync(join(sliceDir, "plan.md"), "# Plan\n", "utf8");
  writeFileSync(join(sliceDir, "test-plan.md"), "# Test plan\n", "utf8");

  if (options.includeHostileLegacyProjection) {
    writeFileSync(join(vault, "projects", "demo", "backlog.md"), `---\ntype: projection\nproject: demo\n---\n# Backlog\n\n- [ ] ${sliceId} legacy row says blocked forever\n`, "utf8");
  }

  return vault;
}

function passingEvidence() {
  return [
    { kind: "tdd", command: "bun test tests/forge-kernel/status.test.ts", result: "passed", recordedAt: "2026-04-28T06:00:00.000Z" },
    { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T06:00:01.000Z" },
    { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T06:00:02.000Z" },
  ];
}

describe("forge slice-specific forge status", () => {
  test("slice-specific status routes to Forge even with --legacy", () => {
    expect(shouldUseForgeStatus(["demo", sliceId, "--json"])).toBe(true);
    expect(shouldUseForgeStatus(["demo", sliceId, "--legacy", "--json"])).toBe(true);
  });

  test("reports draft slices from canonical Forge truth", () => {
    const vault = createVaultWithSlice({ status: "draft" });
    const result = runWiki(["forge", "status", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "draft",
      project: "demo",
      sliceId,
      lifecycleStatus: "draft",
      source: "canonical-records",
      closeGate: { status: "not-ready" },
      nextAction: "finish-planning-or-release",
    });
  });

  test("reports in-progress slices with missing gates", () => {
    const vault = createVaultWithSlice({
      status: "in-progress",
      extraFrontmatter: { claimed_by: "codex", claimed_at: "2026-04-28T05:00:00.000Z" },
    });
    const result = runWiki(["forge", "status", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "missing-gates",
      claimedBy: "codex",
      closeGate: {
        status: "blocked",
        missing: ["tdd", "targeted-verification", "review"],
      },
      nextAction: "record-tdd-evidence",
    });
  });

  test("reports close-ready slices when Forge evidence satisfies gates", () => {
    const vault = createVaultWithSlice({ status: "in-progress", evidence: passingEvidence() });
    const result = runWiki(["forge", "status", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "close-ready",
      closeGate: { status: "ready", missing: [] },
      nextAction: "forge-close",
      evidence: {
        tdd: "passed",
        targetedVerification: "passed",
        review: "approved",
      },
    });
  });

  test("reports rejected slices when review blocks closure", () => {
    const vault = createVaultWithSlice({
      status: "in-progress",
      evidence: [
        ...passingEvidence().slice(0, 2),
        { kind: "review", reviewer: "reviewer", verdict: "needs-changes", recordedAt: "2026-04-28T06:00:02.000Z" },
      ],
    });
    const result = runWiki(["forge", "status", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "rejected",
      closeGate: { status: "blocked", blockedBy: "review requested changes" },
      nextAction: "address-review-feedback",
    });
  });

  test("reports done slices and ignores hostile old projections", () => {
    const vault = createVaultWithSlice({ status: "done", evidence: passingEvidence(), includeHostileLegacyProjection: true });
    const result = runWiki(["forge", "status", "demo", sliceId, "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "done",
      lifecycleStatus: "done",
      closeGate: { status: "closed" },
      nextAction: "none",
      source: "canonical-records",
    });
  });
});
