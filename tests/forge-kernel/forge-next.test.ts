import { describe, expect, test } from "bun:test";
import { evaluateForgeNext } from "../../src/forge/lifecycle/next-intent";
import { renderForgeNextJson, renderForgeNextText } from "../../src/forge/workflow/render-next";

const readySlice = {
  project: "wiki-forge",
  taskId: "WIKI-FORGE-219",
  title: "wire forge cli commands",
  status: "ready" as const,
};

describe("forge next projection", () => {
  test("one active slice returns next action for that slice", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        { ...readySlice, taskId: "WIKI-FORGE-217", status: "in-progress" },
        readySlice,
      ],
      generatedProjectionActiveSliceId: "WIKI-FORGE-999",
    });

    expect(projection).toMatchObject({
      status: "active",
      project: "wiki-forge",
      activeSliceId: "WIKI-FORGE-217",
      nextAction: "continue-active-slice",
      nextCommand: "wiki forge status wiki-forge WIKI-FORGE-217 --json",
      reason: "Active slice exists; inspect slice status and continue its gates.",
      phasePacket: {
        kind: "phase-skill-packet",
        phase: "implementation",
        requiredSkills: ["forge", "tdd"],
      },
      source: "canonical-records",
    });
    const rendered = renderForgeNextText(projection);
    expect(rendered).toContain("Next command: wiki forge status wiki-forge WIKI-FORGE-217 --json");
    expect(rendered).toContain("wiki-forge: continue WIKI-FORGE-217");
    expect(rendered).toContain("Required skills: /forge -> /tdd");
    expect(rendered).toContain("red TDD evidence");
  });

  test("no active slice returns first ready slice or none", () => {
    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        readySlice,
        { ...readySlice, taskId: "WIKI-FORGE-024", status: "draft" },
      ],
    })).toMatchObject({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start wiki-forge WIKI-FORGE-219",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });

    const emptyProjection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
      ],
    });

    expect(emptyProjection).toMatchObject({
      status: "empty",
      project: "wiki-forge",
      nextAction: "project-complete-or-plan-more-scope",
      noSafeCommandReason: "No open Forge slices exist. Stop here unless the user wants more scope; then run wiki forge plan to create the next slice.",
      reason: "No active, ready, or draft Forge slices exist; current Forge slice set is complete or empty.",
      continuation: {
        mode: "no-open-slices",
        minimalRefreshCommands: [
          "wiki checkpoint wiki-forge --repo <path> --base HEAD --json",
          "wiki forge next wiki-forge --repo <path> --json",
        ],
        allowedContext: ["latest handover", "checkpoint truth", "Forge next/status truth", "explicitly referenced artifacts"],
        forbiddenContext: ["reconstructing the prior conversation", "broad wiki queries by default", "mutating lifecycle without user scope"],
        nextScopeCommand: "wiki forge plan wiki-forge <feature-name> --repo <path>",
      },
      source: "canonical-records",
    });
    const text = renderForgeNextText(emptyProjection);
    expect(text).toContain("Minimal refresh:");
    expect(text).toContain("wiki checkpoint wiki-forge --repo <path> --base HEAD --json");
    expect(text).toContain("Forbidden context:");
    expect(text).toContain("New-scope workflow:");
    expect(text).toContain("1. Confirm the user wants more scope.");
    expect(text).toContain("2. Write one plan-answer file with outcome, non-goals, context/decisions, PRD criteria, and slice breakdown.");
    expect(text).toContain("3. Run: wiki forge plan wiki-forge <feature-name> --repo <path> --plan-answer-file <file>");
    expect(text).toContain("4. Add PRD/slice candidates, complete the session, create artifacts, then run wiki forge next.");
    expect(text).toContain("Do not release/start anything until Forge creates draft slices for that new scope.");
    expect(text).not.toContain("wiki forge release wiki-forge <slice>");
    if (emptyProjection.status !== "empty") throw new Error("expected empty projection");
    for (const forbidden of emptyProjection.continuation.forbiddenContext) expect(text).toContain(`- ${forbidden}`);
  });

  test("draft-only project returns release guidance instead of project-complete guidance", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-218", status: "done" },
        { ...readySlice, taskId: "WIKI-FORGE-024", title: "remove old helper", status: "draft" },
        { ...readySlice, taskId: "WIKI-FORGE-025", title: "fix help output", status: "draft" },
      ],
    });

    expect(projection).toMatchObject({
      status: "drafts",
      project: "wiki-forge",
      nextCommand: "wiki forge release wiki-forge WIKI-FORGE-024",
      reason: "Draft slices exist but must be released before start.",
      draftSlices: [
        {
          sliceId: "WIKI-FORGE-024",
          title: "remove old helper",
          commands: {
            release: "wiki forge release wiki-forge WIKI-FORGE-024",
            startAfterRelease: "wiki forge start wiki-forge WIKI-FORGE-024",
          },
        },
        {
          sliceId: "WIKI-FORGE-025",
          title: "fix help output",
          commands: {
            release: "wiki forge release wiki-forge WIKI-FORGE-025",
            startAfterRelease: "wiki forge start wiki-forge WIKI-FORGE-025",
          },
        },
      ],
      nextAction: "release-draft-slice",
      candidates: [
        {
          sliceId: "WIKI-FORGE-024",
          title: "remove old helper",
          nextCommand: "wiki forge release wiki-forge WIKI-FORGE-024",
        },
        {
          sliceId: "WIKI-FORGE-025",
          title: "fix help output",
          nextCommand: "wiki forge release wiki-forge WIKI-FORGE-025",
        },
      ],
      source: "canonical-records",
    });
    const text = renderForgeNextText(projection);
    expect(text).toContain("wiki-forge: draft slices need release before start");
    expect(text.split("\n").slice(0, 3).join("\n")).toContain("Next command: wiki forge release wiki-forge WIKI-FORGE-024");
    expect(text).toContain("WIKI-FORGE-024 remove old helper");
    expect(text).toContain("release: wiki forge release wiki-forge WIKI-FORGE-024");
    expect(text).toContain("start after release: wiki forge start wiki-forge WIKI-FORGE-024");
    expect(text.trimEnd().endsWith("Next command: wiki forge release wiki-forge WIKI-FORGE-024")).toBe(true);
    expect(JSON.parse(renderForgeNextJson(projection))).toEqual(projection);
  });

  test("planning sessions are surfaced when no open slices exist", () => {
    const draftProjection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [{ ...readySlice, taskId: "WIKI-FORGE-218", status: "done" }],
      planningSessions: [
        { project: "wiki-forge", featureName: "Safer deploy", sessionId: "safer-deploy", status: "draft" },
      ],
    });

    expect(draftProjection).toMatchObject({
      status: "planning-session",
      project: "wiki-forge",
      featureName: "Safer deploy",
      sessionId: "safer-deploy",
      nextAction: "continue-planning-session",
      nextCommand: "wiki forge plan wiki-forge 'Safer deploy' --json",
      reason: "A Forge planning session exists and needs completion before artifact creation.",
      phasePacket: {
        kind: "phase-skill-packet",
        phase: "plan",
        requiredSkills: ["grill-with-docs", "forge"],
      },
      source: "canonical-records",
    });
    expect(renderForgeNextText(draftProjection)).toContain("wiki-forge: continue planning session Safer deploy");
    expect(renderForgeNextText(draftProjection)).toContain("Required skills: /grill-with-docs -> /forge");

    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [],
      planningSessions: [
        { project: "wiki-forge", featureName: "Safer deploy", sessionId: "safer-deploy", status: "ready-for-artifacts" },
      ],
    })).toMatchObject({
      status: "planning-session",
      nextAction: "create-planning-artifacts",
      nextCommand: "wiki forge plan wiki-forge 'Safer deploy' --create-artifacts",
    });
  });

  test("multiple active slices return typed conflict and recovery", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { ...readySlice, taskId: "WIKI-FORGE-216", status: "in-progress" },
        { ...readySlice, taskId: "WIKI-FORGE-217", status: "in-progress" },
      ],
    });

    expect(projection.status).toBe("conflict");
    if (projection.status !== "conflict") throw new Error("expected conflict");
    expect(projection.rejection.code).toBe("MultipleActiveSlices");
    expect(projection.rejection.recovery[0]?.command).toContain("wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217");
  });

  test("JSON output is parseable", () => {
    const projection = evaluateForgeNext({ project: "wiki-forge", slices: [readySlice] });
    expect(JSON.parse(renderForgeNextJson(projection))).toMatchObject({
      status: "ready",
      project: "wiki-forge",
      nextSliceId: "WIKI-FORGE-219",
      nextAction: "start-ready-slice",
      nextCommand: "wiki forge start wiki-forge WIKI-FORGE-219",
      reason: "A released slice is ready to start.",
      source: "canonical-records",
    });
  });
});
