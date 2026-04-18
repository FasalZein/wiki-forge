import { describe, expect, test } from "bun:test";
import {
  classifyStateField,
  RECONCILER_WRITE_SCOPE_CONTRACTS,
  resolveStateContract,
} from "../src/lib/state-contract";

describe("state contract", () => {
  test("resolves project summary contract with authored, computed, and evidence fields", () => {
    const contract = resolveStateContract("_summary.md", { type: "project" });
    expect(contract?.id).toBe("project-summary");
    expect(contract?.scope).toBe("project");
    expect(contract?.frontmatter.authored).toContain("repo");
    expect(contract?.frontmatter.authored).toContain("code_paths");
    expect(contract?.frontmatter.computed).toContain("updated");
    expect(contract?.frontmatter.evidence).toContain("verification_level");
    expect(classifyStateField(contract!, "repo")).toBe("authored");
    expect(classifyStateField(contract!, "updated")).toBe("computed");
    expect(classifyStateField(contract!, "verification_level")).toBe("evidence");
  });

  test("resolves feature and prd contracts as project-scoped planning pages", () => {
    const feature = resolveStateContract("specs/features/FEAT-017-demo.md", {
      type: "spec",
      spec_kind: "feature",
    });
    const prd = resolveStateContract("specs/prds/PRD-044-demo.md", {
      type: "spec",
      spec_kind: "prd",
    });

    expect(feature?.id).toBe("feature");
    expect(feature?.scope).toBe("project");
    expect(feature?.frontmatter.authored).toContain("feature_id");
    expect(feature?.frontmatter.computed).toContain("computed_status");
    expect(prd?.id).toBe("prd");
    expect(prd?.frontmatter.authored).toContain("parent_feature");
    expect(prd?.frontmatter.computed).toContain("computed_status");
  });

  test("resolves slice contracts with slice scope and canonical lifecycle fields", () => {
    const index = resolveStateContract("specs/slices/WIKI-FORGE-123/index.md", {
      type: "spec",
      spec_kind: "task-hub",
    });
    const plan = resolveStateContract("specs/slices/WIKI-FORGE-123/plan.md", {
      type: "spec",
      spec_kind: "plan",
    });
    const testPlan = resolveStateContract("specs/slices/WIKI-FORGE-123/test-plan.md", {
      type: "spec",
      spec_kind: "test-plan",
    });

    expect(index?.id).toBe("slice-index");
    expect(index?.scope).toBe("slice");
    expect(index?.frontmatter.authored).toContain("status");
    expect(index?.frontmatter.authored).toContain("claimed_by");
    expect(index?.frontmatter.evidence).toContain("verification_level");
    expect(plan?.id).toBe("slice-plan");
    expect(plan?.scope).toBe("slice");
    expect(testPlan?.id).toBe("slice-test-plan");
    expect(testPlan?.frontmatter.evidence).toContain("verification_level");
  });

  test("resolves protocol and handover contracts with dedicated scopes", () => {
    const protocol = resolveStateContract("AGENTS.md", { managed_by: "wiki-forge" });
    const handover = resolveStateContract("handovers/2026-04-17-session.md", { type: "handover" });

    expect(protocol?.id).toBe("protocol-surface");
    expect(protocol?.scope).toBe("protocol");
    expect(protocol?.frontmatter.computed).toContain("protocol_version");
    expect(handover?.id).toBe("session-handover");
    expect(handover?.scope).toBe("history");
    expect(handover?.writePolicy.body).toContain("append-only-history");
  });

  test("defines reconciler write permissions by scope", () => {
    expect(RECONCILER_WRITE_SCOPE_CONTRACTS.slice.frontmatter).toEqual([
      "updated",
      "verification_level",
      "previous_level",
      "stale_since",
      "verified_against",
      "computed_status",
    ]);
    expect(RECONCILER_WRITE_SCOPE_CONTRACTS.project.body).toContain("generated-index-sections");
    expect(RECONCILER_WRITE_SCOPE_CONTRACTS.history.body).toEqual(["append-only-history"]);
    expect(RECONCILER_WRITE_SCOPE_CONTRACTS.protocol.body).toEqual(["managed-protocol-block"]);
  });
});
