import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanupTempPaths, runWiki } from "./test-helpers";
import { createStaleActiveSlice, setupForgeDogfoodHarness } from "./_helpers/forge-dogfood-harness";

afterEach(() => {
  cleanupTempPaths();
});

describe("Forge dogfood harness", () => {
  test("proves the Forge SDLC with real CLI commands", () => {
    const harness = setupForgeDogfoodHarness();

    const next = expectSuccessfulJson<{
      targetSlice: string;
      triage: { command: string };
      steering: { nextCommand: string };
    }>(harness.runForgeNext());
    expect(next.targetSlice).toBe(harness.sliceId);
    expect(next.triage.command).toContain(harness.sliceId);
    expect(next.steering.nextCommand).toContain(harness.sliceId);

    const status = expectSuccessfulJson<{
      project: string;
      context: { id: string };
      triage: { command: string };
    }>(harness.runForgeStatus());
    expect(status.project).toBe(harness.project);
    expect(status.context.id).toBe(harness.sliceId);
    expect(status.triage.command).toContain(harness.sliceId);

    const checkpoint = expectSuccessfulJson<{ gitTruth: unknown; clean: boolean }>(harness.runCheckpoint());
    expect(checkpoint.gitTruth).toBeDefined();
    expect(typeof checkpoint.clean).toBe("boolean");

    expect(harness.recordTddEvidence().exitCode).toBe(0);
    expect(harness.recordVerifyEvidence().exitCode).toBe(0);
    expect(harness.recordReview().exitCode).toBe(0);

    const run = expectSuccessfulJson<{ check: { ok: boolean }; close: { ok: boolean } }>(harness.runForge());
    expect(run.check.ok).toBe(true);
    expect(run.close.ok).toBe(true);

    const finalStatus = expectSuccessfulJson<{ triage: { kind: string }; context: { id: string } }>(harness.runForgeStatus());
    expect(finalStatus.context.id).toBe(harness.sliceId);
    expect(finalStatus.triage.kind).toBe("completed");

    const indexContent = readFileSync(harness.paths.index, "utf8");
    expect(indexContent).toContain("pipeline_progress:");
    expect(indexContent).toContain("forge_workflow_ledger:");
    expect(indexContent).toContain("forge_review_evidence:");
    expect(indexContent).toContain("last_forge_ok: true");
    expect(indexContent).toContain("status: done");
  });

  test("prevents stale active slices from hijacking explicit runs", () => {
    const harness = setupForgeDogfoodHarness({ project: "dogstale", featureName: "dogfood stale focus" });
    const { staleSliceId } = createStaleActiveSlice(harness);

    const status = expectSuccessfulJson<{ context: { id: string }; activeSlice: string }>(harness.runForgeStatus(harness.sliceId));
    expect(status.context.id).toBe(harness.sliceId);
    expect(status.activeSlice).toBe(staleSliceId);

    expect(harness.recordTddEvidence().exitCode).toBe(0);
    expect(harness.recordVerifyEvidence().exitCode).toBe(0);
    expect(harness.recordReview().exitCode).toBe(0);

    const run = harness.runForge(harness.sliceId);
    if (run.exitCode !== 0) {
      const payload = run.json<{ step?: string; recovery?: string[] }>();
      expect(payload.step).toBe("operator-lane");
      expect(payload.recovery?.join("\n")).toContain(`wiki forge release ${harness.project} ${staleSliceId}`);
      expect(runWiki(["forge", "release", harness.project, staleSliceId], harness.env).exitCode).toBe(0);
      const afterRelease = expectSuccessfulJson<{ check: { ok: boolean }; close: { ok: boolean } }>(harness.runForge(harness.sliceId));
      expect(afterRelease.check.ok).toBe(true);
      expect(afterRelease.close.ok).toBe(true);
      return;
    }

    const payload = run.json<{ check: { ok: boolean }; close: { ok: boolean } }>();
    expect(payload.check.ok).toBe(true);
    expect(payload.close.ok).toBe(true);
  });

  test("keeps status next run and checkpoint coherent", () => {
    const harness = setupForgeDogfoodHarness({ project: "dogcohere", featureName: "dogfood coherence" });

    const next = expectSuccessfulJson<{ targetSlice: string; triage: { command: string }; steering: { nextCommand: string } }>(harness.runForgeNext());
    const status = expectSuccessfulJson<{ context: { id: string }; steering: { nextCommand: string }; triage: { command: string } }>(harness.runForgeStatus());
    const checkpoint = expectSuccessfulJson<{ gitTruth: unknown }>(harness.runCheckpoint());

    expect(next.targetSlice).toBe(harness.sliceId);
    expect(status.context.id).toBe(harness.sliceId);
    expect(status.steering.nextCommand).toContain(harness.sliceId);
    expect(status.triage.command).toContain(harness.sliceId);
    expect(checkpoint.gitTruth).toBeDefined();

    expect(harness.recordTddEvidence().exitCode).toBe(0);
    expect(harness.recordVerifyEvidence().exitCode).toBe(0);
    expect(harness.recordReview().exitCode).toBe(0);

    const run = expectSuccessfulJson<{ steering: { nextCommand: string }; check: { ok: boolean }; close: { ok: boolean } }>(harness.runForge());
    expect(run.steering.nextCommand).toContain(harness.sliceId);
    expect(run.check.ok).toBe(true);
    expect(run.close.ok).toBe(true);

    const finalStatus = expectSuccessfulJson<{ context: { id: string }; triage: { kind: string } }>(harness.runForgeStatus());
    expect(finalStatus.context.id).toBe(harness.sliceId);
    expect(finalStatus.triage.kind).toBe("completed");

    const finalNext = expectSuccessfulJson<{ targetSlice: string | null; triage?: { kind: string } }>(harness.runForgeNext());
    expect(
      finalNext.targetSlice === null
        || finalNext.targetSlice !== harness.sliceId
        || finalNext.triage?.kind === "completed",
    ).toBe(true);
  });
});

function expectSuccessfulJson<T>(result: ReturnType<typeof runWiki>): T {
  expect(result.exitCode).toBe(0);
  return result.json<T>();
}
