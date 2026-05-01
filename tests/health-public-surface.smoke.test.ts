import { describe, expect, test } from "bun:test";
import * as health from "../src/health";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const expectedExports = [
  "checkpoint",
  "collectCheckpoint",
  "collectReadinessCheck",
  "collectReadinessReview",
  "collectMaintenancePlan",
  "collapseActions",
  "commitCheck",
  "compactDoctorForJson",
  "dashboardProject",
  "discoverProject",
  "doctorProject",
  "driftCheck",
  "readinessCheckProject",
  "ingestDiff",
  "installGitHook",
  "isTestFile",
  "lintRepo",
  "maintainProject",
  "refreshFromGit",
  "refreshOnMerge",
  "readinessReviewProject",
  "refreshProject",
  "syncProject",
].sort();

describe("health public surface", () => {
  test("only exposes the shared health boundary", () => {
    expect(Object.keys(health).sort()).toEqual(expectedExports);
  });

  test("domain-owned helpers are routed through health instead of lib", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "health", "shared", "diagnostics.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "health", "shared", "dirty-repo.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "health", "drift", "query.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "health", "health"))).toBe(false);
    expect(existsSync(join(repoRoot, "src", "maintenance"))).toBe(false);
  });

  test("git truth is shared infrastructure, not Forge-owned health coupling", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "shared", "git-truth.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "forge", "core", "git-truth.ts"))).toBe(false);
  });

  test("diagnostics are a shared gate contract, not health-owned Forge coupling", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "shared", "diagnostics.ts"))).toBe(true);
  });

  test("health is a first-class boundary, not one broad maintenance transition zone", () => {
    const repoRoot = join(import.meta.dir, "..");
    const fallowConfig = readFileSync(join(repoRoot, "fallow.json"), "utf8");

    expect(fallowConfig).not.toContain("maintenance-transition");
    expect(fallowConfig).not.toContain("maintenance-checkpoint");
    expect(fallowConfig).toContain("health-checkpoint");
    expect(fallowConfig).toContain("health-readiness");
    expect(fallowConfig).toContain("health-sync");
    expect(fallowConfig).toContain("health-core");
  });
});
