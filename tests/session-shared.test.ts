import { describe, expect, test } from "bun:test";
import { compactLogEntry } from "../src/session/_shared";

describe("session shared helpers", () => {
  test("compacts log entries while dropping the project detail line", () => {
    const entry = [
      "## 2026-04-17] note | left off at parser",
      "- project: demo",
      "- slice: DEMO-001",
      "- agent: pi",
    ].join("\n");

    expect(compactLogEntry(entry)).toBe("2026-04-17] note | left off at parser | - slice: DEMO-001 | - agent: pi");
  });
});
