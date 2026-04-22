import { describe, expect, test } from "bun:test";
import { formatMaintenanceActionLabel } from "../src/maintenance/shared";

describe("diagnostics", () => {
  test("formatMaintenanceActionLabel includes scope when present", () => {
    expect(formatMaintenanceActionLabel({ kind: "add-tests", scope: "slice" })).toBe("[slice][add-tests]");
  });

  test("formatMaintenanceActionLabel omits scope when absent", () => {
    expect(formatMaintenanceActionLabel({ kind: "review-page" })).toBe("[review-page]");
  });

  test("formatMaintenanceActionLabel handles all scope values", () => {
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "parent" })).toBe("[parent][fix]");
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "project" })).toBe("[project][fix]");
    expect(formatMaintenanceActionLabel({ kind: "fix", scope: "history" })).toBe("[history][fix]");
  });
});
