import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as hierarchy from "../../src/wiki/project-views";
import { repoRoot } from "../_helpers/wiki-subprocess";

describe("legacy public barrels", () => {
  test("session legacy barrel is deleted", () => {
    expect(existsSync(join(repoRoot, "src", "session"))).toBe(false);
  });

  test("hierarchy barrel exposes read/admin helpers, not legacy mutators", () => {
    expect("collectBacklog" in hierarchy).toBe(true);
    expect("createFeature" in hierarchy).toBe(false);
    expect("createPrd" in hierarchy).toBe(false);
    expect("appendTaskToBacklog" in hierarchy).toBe(false);
    expect("moveTaskToSection" in hierarchy).toBe(false);
  });

  test("slice legacy barrel is deleted", () => {
    expect(existsSync(join(repoRoot, "src", "slice"))).toBe(false);
  });
});
