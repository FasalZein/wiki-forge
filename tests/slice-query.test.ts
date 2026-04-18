import { describe, expect, test } from "bun:test";
import { isHistoricalDoneSlicePage } from "../src/lib/slice-query";

describe("slice-query", () => {
  test("returns true for a done slice page under specs/slices/", () => {
    const entry = {
      page: "specs/slices/DEMO-001/index.md",
      parsed: { data: { status: "done" }, content: "" } as ReturnType<typeof import("../src/cli-shared").safeMatter>,
    };
    expect(isHistoricalDoneSlicePage(entry)).toBe(true);
  });

  test("returns false for a slice page that is not done", () => {
    const entry = {
      page: "specs/slices/DEMO-001/index.md",
      parsed: { data: { status: "in-progress" }, content: "" } as ReturnType<typeof import("../src/cli-shared").safeMatter>,
    };
    expect(isHistoricalDoneSlicePage(entry)).toBe(false);
  });

  test("returns false for a non-slice page even if status is done", () => {
    const entry = {
      page: "modules/auth/spec.md",
      parsed: { data: { status: "done" }, content: "" } as ReturnType<typeof import("../src/cli-shared").safeMatter>,
    };
    expect(isHistoricalDoneSlicePage(entry)).toBe(false);
  });

  test("returns false when parsed is null", () => {
    const entry = { page: "specs/slices/DEMO-001/index.md", parsed: null };
    expect(isHistoricalDoneSlicePage(entry)).toBe(false);
  });

  test("returns true for nested slice doc files like plan.md", () => {
    const entry = {
      page: "specs/slices/DEMO-001/plan.md",
      parsed: { data: { status: "done" }, content: "" } as ReturnType<typeof import("../src/cli-shared").safeMatter>,
    };
    expect(isHistoricalDoneSlicePage(entry)).toBe(true);
  });

  test("returns false for a page at the specs/slices/ root without a slice subdirectory", () => {
    const entry = {
      page: "specs/slices/index.md",
      parsed: { data: { status: "done" }, content: "" } as ReturnType<typeof import("../src/cli-shared").safeMatter>,
    };
    expect(isHistoricalDoneSlicePage(entry)).toBe(false);
  });
});
