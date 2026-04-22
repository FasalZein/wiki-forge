import { describe, expect, test } from "bun:test";
import * as hierarchy from "../src/hierarchy";
import * as slice from "../src/slice";

const expectedHierarchyExports = [
  "addTask",
  "appendTaskToBacklog",
  "backlogCommand",
  "closeFeature",
  "closePrd",
  "collectBacklog",
  "collectBacklogFocus",
  "collectBacklogView",
  "collectCancelledSyncActions",
  "collectHierarchyStatusActions",
  "collectLifecycleDriftActions",
  "collectStaleIndexTargets",
  "collectTaskContextForId",
  "completeTask",
  "computeEntityStatus",
  "createFeature",
  "createFeatureReturningId",
  "createLayerPage",
  "createPlan",
  "createPrd",
  "createPrdReturningId",
  "createTestPlan",
  "dependencyGraph",
  "detectTaskDocState",
  "featureStatusCommand",
  "lifecycleClose",
  "lifecycleOpen",
  "lintVault",
  "moveTask",
  "moveTaskToSection",
  "parseTaskArgs",
  "rewriteBacklogRowMarker",
  "scaffoldLayer",
  "slugify",
  "startFeature",
  "startPrd",
  "summaryProject",
  "updateIndex",
  "writeNamedNavigationTargets",
  "writeNavigationIndex",
  "writeProjectIndex",
].sort();

const expectedSliceExports = [
  "claimSlice",
  "closeSlice",
  "createIssueSlice",
  "detectDomainModelRefs",
  "detectPrdRefs",
  "detectResearchRefs",
  "detectSlicesPhase",
  "detectTddEvidence",
  "detectVerifyPhase",
  "repairHistoricalDoneSlices",
  "startSlice",
  "tailLogFromPath",
  "verifySlice",
].sort();

describe("slice and hierarchy public surfaces", () => {
  test("hierarchy only exposes the shared workflow boundary", () => {
    expect(Object.keys(hierarchy).sort()).toEqual(expectedHierarchyExports);
  });

  test("slice only exposes command-facing and evidence-reader APIs", () => {
    expect(Object.keys(slice).sort()).toEqual(expectedSliceExports);
  });
});
