import { describe, expect, test } from "bun:test";
import {
  buildCanonicalProtocolSource,
  renderHandoverAlignmentReminder,
  renderPromptProtocolReminders,
  renderProtocolSurface,
} from "../src/protocol/source";

describe("protocol source", () => {
  test("renders managed protocol surfaces from one canonical source", () => {
    const source = buildCanonicalProtocolSource("demo", { path: ".", scope: "root" });
    const rendered = renderProtocolSurface("demo", { path: ".", scope: "root" });

    expect(source.managedBy).toBe("wiki-forge");
    expect(source.protocolVersion).toBe(2);
    expect(rendered).toContain("managed_by: wiki-forge");
    expect(rendered).toContain(source.workflowLines[0]);
    expect(rendered).toContain("wiki forge plan|start|check|run|close|next|status demo");
    expect(rendered).toContain("Workflow Enforcement");
  });

  test("prompt and handover adapters reuse canonical protocol guidance", () => {
    const reminders = renderPromptProtocolReminders("demo");
    const handoverReminder = renderHandoverAlignmentReminder("demo");

    expect(reminders).toContain("Use `/forge` for non-trivial implementation work.");
    expect(reminders.some((line) => line.includes("wiki forge plan demo"))).toBe(true);
    expect(reminders.some((line) => line.includes("wiki forge run demo"))).toBe(true);
    expect(handoverReminder).toContain("load `/wiki` and `/forge` skills before continuing");
  });
});
