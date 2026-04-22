import { describe, expect, test } from "bun:test";
import {
  buildCanonicalProtocolSource,
  renderHandoverAlignmentReminder,
  renderPromptProtocolReminders,
  renderProtocolSurface,
} from "../src/protocol/source";

describe("protocol source library", () => {
  test("defines the canonical policy model and renderer", () => {
    const source = buildCanonicalProtocolSource("demo", { path: ".", scope: "root" });
    const rendered = renderProtocolSurface("demo", { path: ".", scope: "root" });

    expect(source.workflowLines).toContain("Use `/forge` for non-trivial implementation work.");
    expect(rendered).toContain("## Workflow Enforcement");
    expect(rendered).toContain("`wiki forge plan demo <feature-name>`");
    expect(rendered).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(rendered).toContain("`wiki forge next demo`");
    expect(rendered).toContain("No bare `catch {}`, no swallowed promises, no placeholder throw sites.");
    expect(rendered).not.toContain('throw new Error("TODO")');
  });

  test("renders prompt and handover reminders from the same source", () => {
    const reminders = renderPromptProtocolReminders("demo");

    expect(reminders).toContain("Use `/forge` for non-trivial implementation work.");
    expect(reminders).toContain("Plan tracked work with `wiki forge plan demo <feature-name>`.");
    expect(reminders).toContain("Run the active slice with `wiki forge run demo [slice-id] --repo <path>`.");
    expect(reminders).toContain("If no slice is active, use `wiki forge next demo`.");
    expect(reminders.join("\n")).not.toContain("creates feature + PRD + slice + starts it");
    expect(renderHandoverAlignmentReminder("demo")).toContain("Next Session Priorities");
  });
});
