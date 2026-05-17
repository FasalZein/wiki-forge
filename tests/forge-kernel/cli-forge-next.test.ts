import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";
import { resolveWikiCommand } from "../../src/wiki";

afterEach(() => cleanupTempPaths());

function createVaultWithReadySlice() {
  const vault = tempDir("wiki-next-vault");
  initVault(vault);
  writeSlice(vault, "DEMO-001", "ready slice", "ready");
  writeFileSync(join(vault, "projects", "demo", "backlog.md"), `---\ntype: projection\nproject: demo\n---\n# Legacy backlog\n\n- [ ] DEMO-999 hostile legacy row\n`, "utf8");
  return vault;
}

function createVaultWithDraftSlices() {
  const vault = tempDir("wiki-next-draft-vault");
  initVault(vault);
  writeSlice(vault, "DEMO-001", "first draft slice", "draft");
  writeSlice(vault, "DEMO-002", "second draft slice", "draft");
  return vault;
}

function createVaultWithPlanningSession() {
  const vault = tempDir("wiki-next-planning-vault");
  initVault(vault);
  const sessionsDir = join(vault, "projects", "demo", "forge", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, "safer-deploy.md"), `---\ntitle: Planning session — Safer deploy\ntype: planning-session\nproject: demo\nfeature_name: Safer deploy\nsession_id: safer-deploy\nstatus: ready-for-artifacts\ncreated_at: '2026-05-15T00:00:00.000Z'\nupdated_at: '2026-05-15T00:00:00.000Z'\nanswers: []\nprds: []\n---\n# Planning session\n`, "utf8");
  return vault;
}

function writeSlice(vault: string, sliceId: string, title: string, status: "draft" | "ready") {
  const sliceDir = join(vault, "projects", "demo", "forge", "slices", sliceId);
  mkdirSync(sliceDir, { recursive: true });
  writeFileSync(join(sliceDir, "index.md"), `---\ntitle: ${sliceId} ${title}\ntype: forge-slice\nproject: demo\ntask_id: ${sliceId}\nstatus: ${status}\n---\n# ${sliceId}\n`, "utf8");
}

describe("Forge top-level next", () => {
  test("top-level next routes to Forge next instead of removed session next", () => {
    expect(resolveWikiCommand(["next", "demo"]).command).toBe("next");
  });

  test("returns Forge projection and ignores old backlog projection", () => {
    const vault = createVaultWithReadySlice();
    const result = runWiki(["next", "demo", "--json"], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "ready",
      project: "demo",
      nextSliceId: "DEMO-001",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start demo DEMO-001",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });
  });

  test("surfaces planning sessions when no open slices exist", () => {
    const vault = createVaultWithPlanningSession();
    const next = runWiki(["next", "demo", "--json"], { vault });
    const status = runWiki(["forge", "status", "demo", "--json"], { vault });

    for (const result of [next, status]) {
      expect(result.exitCode).toBe(0);
      expect(result.json()).toMatchObject({
        status: "planning-session",
        project: "demo",
        featureName: "Safer deploy",
        sessionId: "safer-deploy",
        planningStatus: "ready-for-artifacts",
        nextAction: "create-planning-artifacts",
        nextCommand: "wiki forge plan demo 'Safer deploy' --create-artifacts",
      });
    }
  });

  test("surfaces draft slice release commands from next and project status", () => {
    const vault = createVaultWithDraftSlices();
    const next = runWiki(["next", "demo", "--json"], { vault });
    const status = runWiki(["forge", "status", "demo", "--json"], { vault });

    for (const result of [next, status]) {
      expect(result.exitCode).toBe(0);
      expect(result.json()).toMatchObject({
        status: "drafts",
        project: "demo",
        nextAction: "release-draft-slice",
        nextCommand: "wiki forge release demo DEMO-001",
        reason: "Draft slices exist but must be released before start.",
        candidates: [
          {
            sliceId: "DEMO-001",
            title: "DEMO-001 first draft slice",
            nextCommand: "wiki forge release demo DEMO-001",
          },
          {
            sliceId: "DEMO-002",
            title: "DEMO-002 second draft slice",
            nextCommand: "wiki forge release demo DEMO-002",
          },
        ],
        draftSlices: [
          {
            sliceId: "DEMO-001",
            title: "DEMO-001 first draft slice",
            commands: {
              release: "wiki forge release demo DEMO-001",
              startAfterRelease: "wiki forge start demo DEMO-001",
            },
          },
          {
            sliceId: "DEMO-002",
            title: "DEMO-002 second draft slice",
            commands: {
              release: "wiki forge release demo DEMO-002",
              startAfterRelease: "wiki forge start demo DEMO-002",
            },
          },
        ],
      });
    }

    const text = runWiki(["next", "demo"], { vault });
    expect(text.exitCode).toBe(0);
    expect(text.stdout.toString()).toContain("demo: draft slices need release before start");
    expect(text.stdout.toString()).toContain("DEMO-001 DEMO-001 first draft slice");
    expect(text.stdout.toString()).toContain("wiki forge release demo DEMO-001");
    expect(text.stdout.toString()).toContain("start after release: wiki forge start demo DEMO-001");
  });
});
