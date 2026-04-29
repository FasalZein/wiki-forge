import { describe, expect, test } from "bun:test";
import * as hierarchy from "../src/hierarchy";
import * as slice from "../src/slice";

const expectedHierarchyExports = [
  "appendTaskToBacklog",
  "collectBacklog",
  "collectBacklogFocus",
  "collectBacklogView",
  "collectCancelledSyncActions",
  "collectHierarchyStatusActions",
  "collectLifecycleDriftActions",
  "collectStaleIndexTargets",
  "collectTaskContextForId",
  "computeEntityStatus",
  "createLayerPage",
  "dependencyGraph",
  "detectTaskDocState",
  "featureStatusCommand",
  "lifecycleClose",
  "lifecycleOpen",
  "lintVault",
  "parseTaskArgs",
  "rewriteBacklogRowMarker",
  "scaffoldLayer",
  "slugify",
  "summaryProject",
  "updateIndex",
  "writeNamedNavigationTargets",
  "writeNavigationIndex",
  "writeProjectIndex",
].sort();

const expectedSliceExports = [
  "detectDomainModelRefs",
  "detectPrdRefs",
  "detectResearchRefs",
  "detectSlicesPhase",
  "detectTddEvidence",
  "detectVerifyPhase",
  "tailLogFromPath",
].sort();

describe("slice and hierarchy public surfaces", () => {
  test("hierarchy only exposes read/support APIs", () => {
    expect(Object.keys(hierarchy).sort()).toEqual(expectedHierarchyExports);
  });

  test("slice only exposes evidence-reader APIs", () => {
    expect(Object.keys(slice).sort()).toEqual(expectedSliceExports);
  });
});
