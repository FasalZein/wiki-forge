import { describe, expect, test } from "bun:test";
import * as maintenance from "../src/maintenance";
import { existsSync } from "node:fs";
import { join } from "node:path";

const expectedExports = [
  "checkpoint",
  "closeoutProject",
  "collectCheckpoint",
  "collectCloseout",
  "collectGate",
  "collectMaintenancePlan",
  "collapseActions",
  "commitCheck",
  "compactDoctorForJson",
  "dashboardProject",
  "discoverProject",
  "doctorProject",
  "driftCheck",
  "gateProject",
  "ingestDiff",
  "installGitHook",
  "isTestFile",
  "lintRepo",
  "maintainProject",
  "refreshFromGit",
  "refreshOnMerge",
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
});
