import { describe, expect, test } from "bun:test";
import {
  buildCanonicalProtocolSource,
  renderHandoverAlignmentReminder,
  renderPromptProtocolReminders,
  renderProtocolSurface,
} from "../src/lib/protocol-source";

describe("protocol source library", () => {
  test("defines the canonical policy model and renderer", () => {
    const source = buildCanonicalProtocolSource("demo", { path: ".", scope: "root" });
    const rendered = renderProtocolSurface("demo", { path: ".", scope: "root" });

    expect(source.workflowLines).toContain("Use `/forge` for non-trivial implementation work.");
    expect(source.lifecycle.beforeStarting[0]).toContain("wiki start-slice demo <slice-id>");
    expect(rendered).toContain("## Wiki Protocol");
    expect(rendered).toContain(source.lifecycle.beforeCompletion[5]);
  });

  test("renders prompt and handover reminders from the same source", () => {
    expect(renderPromptProtocolReminders("demo").length).toBeGreaterThan(3);
    expect(renderHandoverAlignmentReminder("demo")).toContain("Next Session Priorities");
  });
});
