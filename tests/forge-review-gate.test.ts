import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewGateStatus } from "../src/forge/core/reviews";
import { parseForgeReviewRecordArgs } from "../src/slice/forge/review";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

protectedCleanup();

const approved = (reviewer: string) => ({ verdict: "approved", reviewer, completedAt: "2026-04-27T00:00:00.000Z", blockers: [] });
const approvedAt = (reviewer: string, head: string) => ({ ...approved(reviewer), git: { head } });

function protectedCleanup() {
  afterEach(() => {
    cleanupTempPaths();
  });
}

function setupReviewFixture() {
  const vault = tempDir("forge-review-vault");
  const repo = tempDir("forge-review-repo");
  initVault(vault);
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "init"]);
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "rvw"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "rvw");
  expect(runWiki(["create-issue-slice", "rvw", "review fixture"], env).exitCode).toBe(0);
  return { vault, repo, env };
}

describe("forge review gate", () => {
  test("legacy slice without review policy is not required", () => {
    expect(reviewGateStatus({}, "proj", "SLICE-1").status).toBe("not-required");
  });

  test("required review policy with no records is pending with repair hint", () => {
    const status = reviewGateStatus({ review_policy: { required_approvals: 1 } }, "proj", "SLICE-1");
    expect(status.status).toBe("pending");
    expect(status.repair).toBe("wiki forge review record proj SLICE-1 --verdict approved --reviewer <name>");
  });

  test("one approved record is pending when two approvals are required", () => {
    const status = reviewGateStatus({ review_policy: { required_approvals: 2 }, forge_review_evidence: [approved("codex")] }, "proj", "SLICE-1");
    expect(status.status).toBe("pending");
    expect(status.approvals).toBe(1);
  });

  test("needs_changes blocks and includes blocker text", () => {
    const status = reviewGateStatus({
      review_policy: { required_approvals: 1 },
      forge_review_evidence: [{ verdict: "needs_changes", reviewer: "codex", completedAt: "2026-04-27T00:00:00.000Z", blockers: ["fix gate wiring"] }],
    }, "proj", "SLICE-1");
    expect(status.status).toBe("blocked");
    expect(status.blockers).toContain("fix gate wiring");
  });

  test("enough approved records passes", () => {
    const status = reviewGateStatus({ review_policy: { required_approvals: 2 }, forge_review_evidence: [approved("codex"), approved("gpt")] }, "proj", "SLICE-1");
    expect(status.status).toBe("passed");
  });

  test("stale git-bound reviews do not satisfy the current revision", () => {
    const status = reviewGateStatus({
      review_policy: { required_approvals: 1 },
      forge_review_evidence: [approvedAt("codex", "old-head")],
    }, "proj", "SLICE-1", "new-head");
    expect(status.status).toBe("blocked");
    expect(status.approvals).toBe(0);
    expect(status.blockers).toContain("1 review record(s) target an older git revision");
  });

  test("ungitbound legacy reviews can satisfy the gate during migration", () => {
    const status = reviewGateStatus({ review_policy: { required_approvals: 1 }, forge_review_evidence: [approved("codex")] }, "proj", "SLICE-1", "new-head");
    expect(status.status).toBe("passed");
  });

  test("record command rejects invalid verdicts", () => {
    expect(() => parseForgeReviewRecordArgs(["proj", "SLICE-1", "--verdict", "maybe", "--reviewer", "codex"])).toThrow("invalid review verdict");
  });

  test("CLI records review evidence on the slice hub", () => {
    const { vault, repo, env } = setupReviewFixture();

    const result = runWiki([
      "forge", "review", "record", "rvw", "RVW-001",
      "--verdict", "approved",
      "--reviewer", "codex",
      "--model", "gpt-5.5",
      "--repo", repo,
      "--json",
    ], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.recorded.verdict).toBe("approved");
    expect(payload.recorded.git.head).toMatch(/^[a-f0-9]{40}$/u);

    const raw = readFileSync(join(vault, "projects", "rvw", "specs", "slices", "RVW-001", "index.md"), "utf8");
    expect(raw).toContain("forge_review_evidence:");
    expect(raw).toContain("reviewer: codex");
    expect(raw).toContain("model: gpt-5.5");
  });
});
