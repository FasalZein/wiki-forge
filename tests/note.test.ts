import { describe, expect, test } from "bun:test";
import { renderExecutionPrompt } from "../src/session/note";

describe("session note prompt rendering", () => {
  test("includes canonical protocol reminders for pi prompts", () => {
    const prompt = renderExecutionPrompt({
      project: "demo",
      sliceId: "DEMO-001",
      agent: "pi",
      hub: { data: { title: "Demo slice", assignee: "Pi" }, content: "# Demo slice" },
      plan: { data: {}, content: "# Plan\n\n## Scope\n\n- Implement the slice\n" },
      testPlan: { data: {}, content: "# Test Plan\n\n## Verification Commands\n\n```bash\nbun test\n```\n" },
      summary: "---\ntitle: Demo\n---\n\nProject summary",
      sourcePaths: ["src/auth.ts"],
      commands: ["bun test"],
      context: null,
    });

    expect(prompt).toContain("You are pi continuing a tracked wiki-forge slice.");
    expect(prompt).toContain("Protocol reminders:");
    expect(prompt).toContain("Use `/forge` for non-trivial implementation work.");
    expect(prompt).toContain("wiki start-slice demo <slice-id> --agent <name> --repo <path>");
    expect(prompt).toContain("wiki verify-slice demo <slice-id> --repo <path>");
  });
});
