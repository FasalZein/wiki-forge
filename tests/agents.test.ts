import { describe, expect, test } from "bun:test";
import { normalizeAgentName, agentNamesEqual } from "../src/lib/agents";

describe("agent helpers", () => {
  test("normalizeAgentName trims and lowercases", () => {
    expect(normalizeAgentName("  Claude  ")).toBe("claude");
    expect(normalizeAgentName("CODEX")).toBe("codex");
    expect(normalizeAgentName("pi")).toBe("pi");
  });

  test("agentNamesEqual compares case-insensitively after trimming", () => {
    expect(agentNamesEqual("Claude", "claude")).toBe(true);
    expect(agentNamesEqual(" CODEX ", "codex")).toBe(true);
    expect(agentNamesEqual("pi", "claude")).toBe(false);
  });

  test("agentNamesEqual returns false when either name is undefined", () => {
    expect(agentNamesEqual(undefined, "claude")).toBe(false);
    expect(agentNamesEqual("claude", undefined)).toBe(false);
    expect(agentNamesEqual(undefined, undefined)).toBe(false);
  });

  test("agentNamesEqual returns false when either name is empty", () => {
    expect(agentNamesEqual("", "claude")).toBe(false);
    expect(agentNamesEqual("claude", "")).toBe(false);
  });
});
