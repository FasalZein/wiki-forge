import { describe, expect, test } from "bun:test";
import * as hierarchy from "../../src/hierarchy";
import * as session from "../../src/session";
import * as slice from "../../src/slice";

const FORBIDDEN_HIERARCHY_EXPORTS = [
  "addTask",
  "backlogCommand",
  "closeFeature",
  "closePrd",
  "completeTask",
  "createFeature",
  "createPlan",
  "createPrd",
  "createTestPlan",
  "moveTask",
  "startFeature",
  "startPrd",
];

const FORBIDDEN_SLICE_EXPORTS = [
  "claimSlice",
  "closeSlice",
  "createIssueSlice",
  "repairHistoricalDoneSlices",
  "startSlice",
  "verifySlice",
];

const FORBIDDEN_SESSION_EXPORTS = [
  "exportPrompt",
  "handoverProject",
  "logCommand",
  "nextProject",
  "noteProject",
  "resumeProject",
];

describe("legacy public barrels", () => {
  test("do not export quarantined hierarchy workflow commands", () => {
    for (const name of FORBIDDEN_HIERARCHY_EXPORTS) expect(hierarchy).not.toHaveProperty(name);
  });

  test("do not export quarantined slice workflow commands", () => {
    for (const name of FORBIDDEN_SLICE_EXPORTS) expect(slice).not.toHaveProperty(name);
  });

  test("do not export legacy session command adapters", () => {
    for (const name of FORBIDDEN_SESSION_EXPORTS) expect(session).not.toHaveProperty(name);
  });
});
