import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CloseSliceIntent } from "../../src/forge/kernel/intent";
import { evaluateCloseSliceIntent } from "../../src/forge/lifecycle/forge-close-intent";
import { evaluateForgeNext } from "../../src/forge/lifecycle/next-intent";
import type { ForgeEvidenceRecord } from "../../src/forge/lifecycle/evidence";

const docs = {
  readme: readFileSync("README.md", "utf8"),
  setup: readFileSync("SETUP.md", "utf8"),
  wikiSkill: readFileSync("skills/wiki/SKILL.md", "utf8"),
  forgeSkill: readFileSync("skills/forge/SKILL.md", "utf8"),
};

describe("forge dogfood release gate", () => {
  test("docs explain Wiki memory vs Forge lifecycle without mixing authority", () => {
    expect(docs.readme).toContain("Wiki is the second-brain memory layer.");
    expect(docs.readme).toContain("Forge is the SDLC lifecycle layer.");
    expect(docs.readme).toContain("Kernel = truth; projections = help.");
    expect(docs.setup).toContain("Wiki = memory; Forge = lifecycle; Kernel = truth; projections = help.");
  });

  test("skills name lifecycle chain and subagent policy but defer enforcement to CLI/kernel", () => {
    expect(docs.wikiSkill).toContain("Wiki remembers; Forge executes lifecycle.");
    expect(docs.forgeSkill).toContain("The CLI and Forge kernel own phase ordering, invariants, and close gates.");
    expect(docs.forgeSkill).toContain("Use subagents only after the plan identifies non-overlapping files or artifacts.");
    expect(docs.forgeSkill).toContain("research -> domain-model -> spec -> slices -> ownership -> implementation -> tdd -> verification -> review -> close");
  });

  test("Forge dogfood fixture runs through next status and run/close with targeted verification", () => {
    const nextReady = evaluateForgeNext({
      project: "fixture",
      slices: [{ project: "fixture", taskId: "FIX-001", title: "first slice", status: "ready" }],
    });
    expect(nextReady).toMatchObject({ status: "ready", nextSliceId: "FIX-001" });

    const statusActive = evaluateForgeNext({
      project: "fixture",
      slices: [{ project: "fixture", taskId: "FIX-001", title: "first slice", status: "in-progress" }],
    });
    expect(statusActive).toMatchObject({ status: "active", activeSliceId: "FIX-001" });

    const evidence: readonly ForgeEvidenceRecord[] = [
      { kind: "tdd", command: "bun test tests/forge-kernel/dogfood-release.test.ts", result: "passed", recordedAt: "2026-04-28T04:44:00.000Z" },
      { kind: "verification", verificationType: "targeted", command: "bun run check", result: "passed", recordedAt: "2026-04-28T04:44:01.000Z" },
      { kind: "review", reviewer: "reviewer", verdict: "approved", recordedAt: "2026-04-28T04:44:02.000Z" },
    ];
    const closeIntent: CloseSliceIntent = {
      kind: "intent",
      id: "intent-close-fixture",
      type: "forge-close",
      actor: { kind: "agent", id: "codex" },
      context: { project: "fixture", sliceId: "FIX-001", requestedAt: "2026-04-28T04:44:03.000Z" },
      payload: { sliceId: "FIX-001", closedBy: "codex" },
    };

    expect(evaluateCloseSliceIntent(closeIntent, {
      project: "fixture",
      sliceId: "FIX-001",
      evidence,
      reviewPolicy: { required: true },
    }).status).toBe("accepted");
  });

  test("release gate is explicit and separate from per-slice close", () => {
    expect(docs.readme).toContain("Targeted tests = slice proof; full suite = release gate.");
    expect(docs.setup).toContain("Run full `bun test` only for the production Forge release gate, not for normal per-slice closeout.");
  });
});
