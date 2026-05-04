import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "./test-helpers";

afterEach(() => cleanupTempPaths());

describe("vault folder health", () => {
  test("lint-vault classifies ghost projects and generated projections without moving files", () => {
    const vault = tempDir("wiki-vault");
    initVault(vault);
    mkdirSync(join(vault, "projects", "status"), { recursive: true });
    writeFileSync(join(vault, "projects", "status", ".activity.jsonl"), "{}\n", "utf8");
    mkdirSync(join(vault, "projects", "demo"), { recursive: true });
    writeFileSync(join(vault, "projects", "demo", "backlog.md"), "# Generated Backlog\n", "utf8");
    writeFileSync(join(vault, "projects", "_dashboard.md"), "# Dashboard\n", "utf8");

    const result = runWiki(["lint-vault", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    const payload = result.json<{
      ghostProjects: Array<{ project: string; path: string; reason: string }>;
      generatedProjections: Array<{ path: string; reason: string }>;
      issues: string[];
    }>();
    expect(payload.ghostProjects).toEqual([
      {
        project: "status",
        path: "projects/status",
        reason: "project folder contains only activity logs or no markdown files",
      },
    ]);
    expect(payload.generatedProjections).toEqual([
      { path: "projects/_dashboard.md", reason: "workspace generated projection; not canonical truth" },
      { path: "projects/demo/backlog.md", reason: "project generated projection; not lifecycle authority" },
    ]);
    expect(payload.issues).toContain("projects/status ghost project candidate: project folder contains only activity logs or no markdown files");
  });
});
