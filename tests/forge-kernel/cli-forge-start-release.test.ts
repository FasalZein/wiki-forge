import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveForgeCommand } from "../../src/forge";

afterEach(() => cleanupTempPaths());

function createVaultWithSlices(slices: readonly { id: string; status: "draft" | "ready" | "in-progress"; claimedBy?: string }[]) {
  const vault = tempDir("wiki-start-vault");
  initVault(vault);
  for (const slice of slices) {
    const sliceDir = join(vault, "projects", "demo", "forge", "slices", slice.id);
    mkdirSync(sliceDir, { recursive: true });
    writeFileSync(join(sliceDir, "index.md"), `---
title: ${slice.id} test slice
type: forge-slice
project: demo
task_id: ${slice.id}
status: ${slice.status}
${slice.claimedBy ? `claimed_by: ${slice.claimedBy}\nclaimed_at: '2026-04-28T05:00:00.000Z'\n` : ""}---
# ${slice.id}
`, "utf8");
  }
  return vault;
}

function readSlice(vault: string, sliceId: string) {
  return readFileSync(join(vault, "projects", "demo", "forge", "slices", sliceId, "index.md"), "utf8");
}

describe("forge start/release command adapters", () => {
  test("resolver maps forge mutating forge commands", () => {
    expect(resolveForgeCommand(["start", "demo", "DEMO-001", "--agent", "codex"])).toEqual({
      command: "forge:start",
      args: ["demo", "DEMO-001", "--agent", "codex"],
    });
    expect(resolveForgeCommand(["release", "demo", "DEMO-001", "--json"])).toEqual({
      command: "forge:release",
      args: ["demo", "DEMO-001", "--json"],
    });
  });

  test("forge start accepts a ready slice and writes claim metadata", () => {
    const vault = createVaultWithSlices([{ id: "DEMO-001", status: "ready" }]);
    const result = runWiki(["forge", "start", "demo", "DEMO-001", "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ status: "accepted" });
    const slice = readSlice(vault, "DEMO-001");
    expect(slice).toContain("status: in-progress");
    expect(slice).toContain("claimed_by: codex");
    expect(slice).toContain("claimed_at:");
  });

  test("forge start rejects draft slices until they are released", () => {
    const vault = createVaultWithSlices([{ id: "DEMO-001", status: "draft" }]);
    const before = readSlice(vault, "DEMO-001");
    const result = runWiki(["forge", "start", "demo", "DEMO-001", "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "rejected",
      rejection: {
        code: "DraftSliceNotReleased",
        invariant: "draft-slice-release-before-start",
        recovery: [{ command: "wiki forge release demo DEMO-001 --reason \"release draft before start\"" }],
      },
    });
    expect(readSlice(vault, "DEMO-001")).toBe(before);
  });

  test("forge start rejects when another slice is active and does not mutate requested slice", () => {
    const vault = createVaultWithSlices([
      { id: "DEMO-001", status: "in-progress", claimedBy: "codex" },
      { id: "DEMO-002", status: "ready" },
    ]);
    const before = readSlice(vault, "DEMO-002");
    const result = runWiki(["forge", "start", "demo", "DEMO-002", "--agent", "codex", "--json"], { vault });

    expect(result.exitCode).toBe(1);
    expect(result.json()).toMatchObject({
      status: "rejected",
      rejection: { code: "AnotherSliceActive", invariant: "single-active-slice" },
    });
    expect(readSlice(vault, "DEMO-002")).toBe(before);
  });

  test("forge release clears claim metadata and returns active slice to ready", () => {
    const vault = createVaultWithSlices([{ id: "DEMO-001", status: "in-progress", claimedBy: "codex" }]);
    const result = runWiki(["forge", "release", "demo", "DEMO-001", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      status: "released",
      project: "demo",
      sliceId: "DEMO-001",
    });
    const slice = readSlice(vault, "DEMO-001");
    expect(slice).toContain("status: ready");
    expect(slice).not.toContain("claimed_by:");
    expect(slice).not.toContain("claimed_at:");
  });
});
