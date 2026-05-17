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
  tddSkill: readFileSync("skills/tdd/SKILL.md", "utf8"),
  operatorGuide: readFileSync("docs/production-operator-guide.md", "utf8"),
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
    expect(docs.forgeSkill).toContain("File non-overlap alone is not enough");
    expect(docs.forgeSkill).toContain("one active mutating slice per vault");
    expect(docs.forgeSkill).toContain("forge plan -> build -> TDD/EDD -> verify -> review -> close");
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
      { kind: "tdd", phase: "red", command: "bun test tests/forge-kernel/dogfood-release.test.ts", testPaths: ["tests/forge-kernel/dogfood-release.test.ts"], result: "failed", recordedAt: "2026-04-28T04:43:00.000Z" },
      { kind: "tdd", phase: "green", command: "bun test tests/forge-kernel/dogfood-release.test.ts", testPaths: ["tests/forge-kernel/dogfood-release.test.ts"], result: "passed", recordedAt: "2026-04-28T04:44:00.000Z" },
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

  test("production operator guide and skills describe the stable real-project workflow", () => {
    for (const required of [
      "wiki resume <project> --repo <path> --base <rev>",
      "wiki checkpoint <project> --repo <path> --base <rev>",
      "wiki forge plan <project> <feature-name> --repo <path>",
      "wiki forge start <project> <slice-id> --repo <path> --agent <agent>",
      "wiki forge tdd cycle <project> <slice-id>",
      "wiki forge evidence <project> <slice-id> verify",
      "wiki forge review record <project> <slice-id>",
      "wiki forge run <project> <slice-id> --repo <path>",
      "stale handover",
      "Recovery blocks are presentation-only",
      "checkpoint, maintain, and doctor",
      "JSON output remains automation-facing",
      "Project-specific research lives under `projects/<project>/research/`",
      "Global `research/` is only for reusable cross-project topics",
      "A workflow-navigation fix can supersede cleanup or refactor slices",
      "Always record the supersession reason in the new PRD or slice plan",
      "bun run sync:local -- --audit",
    ]) {
      expect(docs.operatorGuide).toContain(required);
    }

    expect(docs.readme).toContain("For production operation, see [Production Operator Guide](docs/production-operator-guide.md).");
    expect(docs.wikiSkill).toContain("For real-project operation, follow `docs/production-operator-guide.md`");
    expect(docs.forgeSkill).toContain("Real-project operator loop");
    expect(docs.tddSkill).toContain("the preferred `tdd cycle` command may use different red and green commands");
  });
});
