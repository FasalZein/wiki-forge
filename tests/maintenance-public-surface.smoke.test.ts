import { describe, expect, test } from "bun:test";
import * as maintenance from "../src/maintenance";
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

describe("maintenance public surface", () => {
  test("only exposes the shared maintenance boundary", () => {
    expect(Object.keys(maintenance).sort()).toEqual(expectedExports);
  });

  test("domain-owned helpers are routed through maintenance instead of lib", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "maintenance", "shared", "diagnostics.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "maintenance", "shared", "dirty-repo.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "maintenance", "drift", "query.ts"))).toBe(true);
  });

  test("git truth is shared infrastructure, not Forge-owned maintenance coupling", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "shared", "git-truth.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src", "forge", "core", "git-truth.ts"))).toBe(false);
  });

  test("diagnostics are a shared gate contract, not maintenance-owned Forge coupling", () => {
    const repoRoot = join(import.meta.dir, "..");

    expect(existsSync(join(repoRoot, "src", "shared", "diagnostics.ts"))).toBe(true);
  });

  test("maintenance is a first-class health boundary, not one broad transition zone", () => {
    const repoRoot = join(import.meta.dir, "..");
    const fallowConfig = readFileSync(join(repoRoot, "fallow.json"), "utf8");

    expect(fallowConfig).not.toContain("maintenance-transition");
    expect(fallowConfig).toContain("maintenance-checkpoint");
    expect(fallowConfig).toContain("maintenance-readiness");
    expect(fallowConfig).toContain("maintenance-sync");
    expect(fallowConfig).toContain("maintenance-health");
  });
});
