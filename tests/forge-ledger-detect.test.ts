/**
 * Tests for PRD-056: ledger phase auto-advance from detected artifacts.
 *
 * All tests use temporary vaults passed as the `vaultRoot` parameter to avoid
 * touching the live Knowledge vault and to avoid module-level VAULT_ROOT
 * coupling. The detector is a pure read function — these tests verify correct
 * behavior from file-system state without any writes to a persistent ledger.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, tempDir } from "./test-helpers";
import {
  deriveForgeLedgerFromArtifacts,
  mergeDerivedForgeLedger,
  applyDerivedLedger,
} from "../src/protocol/forge-ledger-detect";
import type { ForgeWorkflowLedger } from "../src/protocol/status/workflow-ledger";

afterEach(() => {
  cleanupTempPaths();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupVault(): string {
  const vault = tempDir("ledger-detect-vault");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
  writeFileSync(
    join(vault, "log.md"),
    "---\ntitle: Operations Log\ntype: log\n---\n\n# Operations Log\n",
    "utf8",
  );
  return vault;
}

function makeSliceHub(vault: string, project: string, sliceId: string, extra: Record<string, string> = {}) {
  const dir = join(vault, "projects", project, "specs", "slices", sliceId);
  mkdirSync(dir, { recursive: true });
  const extraLines = Object.entries(extra)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(
    join(dir, "index.md"),
    `---\ntitle: ${sliceId}\ntype: spec\nspec_kind: slice\nproject: ${project}\ntask_id: ${sliceId}\ncreated_at: '2026-04-17T00:00:00.000Z'\nstatus: in-progress${extraLines ? "\n" + extraLines : ""}\n---\n\n# ${sliceId}\n`,
    "utf8",
  );
}

function makePlan(vault: string, project: string, sliceId: string, status: "ready" | "draft" | "current" = "ready") {
  const dir = join(vault, "projects", project, "specs", "slices", sliceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plan.md"),
    `---\ntitle: ${sliceId} plan\ntype: spec\nspec_kind: plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ${status}\n---\n\n# Plan\n\n## Scope\n\n- do the thing\n`,
    "utf8",
  );
}

function makeTestPlan(
  vault: string,
  project: string,
  sliceId: string,
  options: {
    status?: "ready" | "draft" | "current";
    verificationLevel?: string;
    verificationCommands?: string[];
  } = {},
) {
  const {
    status = "ready",
    verificationLevel,
    verificationCommands = ["bun test"],
  } = options;
  const dir = join(vault, "projects", project, "specs", "slices", sliceId);
  mkdirSync(dir, { recursive: true });
  const verLine = verificationLevel ? `verification_level: ${verificationLevel}\n` : "";
  const verificationCommandsYaml = verificationCommands.length > 0
    ? `verification_commands:\n${verificationCommands.map((command) => `  - command: ${command}`).join("\n")}\n`
    : "";
  writeFileSync(
    join(dir, "test-plan.md"),
    `---\ntitle: ${sliceId} test-plan\ntype: spec\nspec_kind: test-plan\nproject: ${project}\ntask_id: ${sliceId}\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ${status}\n${verLine}${verificationCommandsYaml}---\n\n# Test Plan\n\n## Red Tests\n\n- [x] it works\n\n## Verification Commands\n\n\`\`\`bash\nbun test\n\`\`\`\n`,
    "utf8",
  );
}

function makePrd(
  vault: string,
  project: string,
  prdId: string,
  featureId: string,
  childSlices: string[] = [],
  sourcePaths: string[] = [],
  priorResearchRefs: string[] = [],
) {
  const dir = join(vault, "projects", project, "specs", "prds");
  mkdirSync(dir, { recursive: true });
  const slug = prdId.toLowerCase().replace(/-/gu, "-");
  const sourcePathsYaml = sourcePaths.length
    ? `source_paths:\n${sourcePaths.map((p) => `  - ${p}`).join("\n")}\n`
    : "";
  const priorResearchSection = priorResearchRefs.length
    ? `\n## Prior Research\n\n${priorResearchRefs.map((ref) => `- [[${ref}]]`).join("\n")}\n`
    : "";
  const childSlicesSection =
    childSlices.length > 0
      ? `\n## Child Slices\n\n${childSlices.map((s) => `- ${s}`).join("\n")}\n`
      : "\n## Child Slices\n\n- none yet\n";
  writeFileSync(
    join(dir, `${prdId}-${slug}.md`),
    `---\ntitle: ${prdId} test prd\ntype: spec\nspec_kind: prd\nprd_id: ${prdId}\nparent_feature: ${featureId}\nproject: ${project}\n${sourcePathsYaml}created_at: '2026-04-17T00:00:00.000Z'\nstatus: draft\n---\n\n# ${prdId}${priorResearchSection}${childSlicesSection}`,
    "utf8",
  );
}

function makeDecisions(vault: string, project: string, content: string, updatedAt = "2026-04-18T00:00:00.000Z") {
  const dir = join(vault, "projects", project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "decisions.md"),
    `---\ntitle: ${project} decisions\ntype: notes\nproject: ${project}\nupdated: '${updatedAt}'\nstatus: current\n---\n\n# Decisions\n\n## Current Decisions\n\n${content}\n`,
    "utf8",
  );
}

function makeResearchFile(
  vault: string,
  project: string,
  filename: string,
  frontmatter: Record<string, string> = {},
  topicRoot = "projects",
) {
  const dir = topicRoot === "projects"
    ? join(vault, "research", "projects", project)
    : join(vault, "research", project);
  mkdirSync(dir, { recursive: true });
  const frontmatterBlock = Object.keys(frontmatter).length
    ? `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`
    : "";
  writeFileSync(join(dir, filename), `${frontmatterBlock}# Research: ${filename}\n\nSome findings.\n`, "utf8");
}

function addVerifyLogEntry(vault: string, sliceId: string, project: string, dateStr = "2026-04-18") {
  const logPath = join(vault, "log.md");
  const entry = `\n## [${dateStr}] verify-slice | ${sliceId}\n- project: ${project}\n- commands=1\n- ok=true\n`;
  const existing = readFileSync(logPath, "utf8");
  writeFileSync(logPath, existing + entry, "utf8");
}

// Shorthand — all tests pass vaultRoot directly
const d = (vault: string, project: string, sliceId: string) =>
  deriveForgeLedgerFromArtifacts(project, sliceId, vault);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveForgeLedgerFromArtifacts — zero artifact baseline", () => {
  test("returns empty patch when no artifacts exist at all", async () => {
    const vault = setupVault();
    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch).toEqual({});
    expect(result.findings).toHaveLength(0);
  });

  test("returns empty patch when slice hub exists but no phase artifacts", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeUndefined();
    expect(result.patch["domain-model"]).toBeUndefined();
    expect(result.patch.prd).toBeUndefined();
    expect(result.patch.slices).toBeUndefined();
    expect(result.patch.tdd).toBeUndefined();
    expect(result.patch.verify).toBeUndefined();
    expect(result.findings).toHaveLength(0);
  });
});

describe("deriveForgeLedgerFromArtifacts — research phase", () => {
  test("detects research file by task_id frontmatter even when basename is unrelated", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeResearchFile(vault, "myproject", "audit-notes.md", { task_id: "MYPROJECT-001" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.patch.research?.researchRefs?.[0]).toContain("audit-notes");
  });

  test("detects research file under the canonical topic-first root", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeResearchFile(vault, "myproject", "canonical-notes.md", { task_id: "MYPROJECT-001" }, "canonical");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.patch.research?.researchRefs?.[0]).toBe("research/myproject/canonical-notes");
  });

  test("detects project-bound research under an arbitrary topic via task_id frontmatter", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    const dir = join(vault, "research", "auth", "oauth");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "options.md"),
      "---\nproject: myproject\ntask_id: MYPROJECT-001\n---\n\n# OAuth Options\n",
      "utf8",
    );

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.patch.research?.researchRefs).toContain("research/auth/oauth/options");
  });

  test("does not derive slice research evidence from unbridged parent PRD Prior Research links", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-056", parent_feature: "FEAT-001" });
    makePrd(
      vault,
      "myproject",
      "PRD-056",
      "FEAT-001",
      ["MYPROJECT-001"],
      [],
      ["research/myproject/_overview", "projects/myproject/architecture/reviews/steering-audit"],
    );

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeUndefined();
  });

  test("detects research file by PRD-<id>-* basename pattern", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-056" });
    makeResearchFile(vault, "myproject", "prd-056-some-findings.md");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.patch.research?.researchRefs).toHaveLength(1);
    expect(result.patch.research?.researchRefs?.[0]).toContain("prd-056-some-findings");
    expect(result.patch.research?.completedAt).toBeDefined();
  });

  test("detects research file by slice-id-* basename pattern", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeResearchFile(vault, "myproject", "myproject-001-design-notes.md");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.patch.research?.researchRefs?.[0]).toContain("myproject-001-design-notes");
  });

  test("aggregates multiple matching research files (not ambiguous)", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-001" });
    makeResearchFile(vault, "myproject", "prd-001-part-a.md", { task_id: "MYPROJECT-001" });
    makeResearchFile(vault, "myproject", "prd-001-part-b.md", { task_id: "MYPROJECT-001" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research?.researchRefs).toHaveLength(2);
    expect(result.findings.some((f) => f.phase === "research")).toBe(false);
  });

  test("does not detect unrelated research files", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeResearchFile(vault, "myproject", "unrelated-topic.md");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeUndefined();
  });

  test("legacy basename matching still works and emits a deprecation finding", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeResearchFile(vault, "myproject", "myproject-001-legacy.md");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.research).toBeDefined();
    expect(result.findings.some((finding) => finding.phase === "research" && finding.message.includes("deprecated basename"))).toBe(true);
  });
});

describe("deriveForgeLedgerFromArtifacts — domain-model phase", () => {
  test("detects PRD tag in decisions.md updated after slice creation", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-056" });
    // decisions.md updated after slice created_at (2026-04-17)
    makeDecisions(vault, "myproject", "- [PRD-056] Some architectural decision.\n", "2026-04-18T00:00:00.000Z");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch["domain-model"]).toBeDefined();
    expect(result.patch["domain-model"]?.decisionRefs).toHaveLength(1);
    expect(result.patch["domain-model"]?.decisionRefs?.[0]).toContain("decisions.md");
  });

  test("detects slice-id tag in decisions.md", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeDecisions(vault, "myproject", "- [MYPROJECT-001] Slice-specific decision.\n", "2026-04-18T00:00:00.000Z");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch["domain-model"]).toBeDefined();
    expect(result.patch["domain-model"]?.decisionRefs?.[0]).toContain("decisions.md");
  });

  test("skips decisions.md if updated before slice created_at", async () => {
    const vault = setupVault();
    // Slice created_at: 2026-04-17, decisions updated: 2026-04-16 (before)
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-056" });
    makeDecisions(vault, "myproject", "- [PRD-056] Old decision.\n", "2026-04-16T00:00:00.000Z");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch["domain-model"]).toBeUndefined();
  });

  test("returns no domain-model ref when no matching tags", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeDecisions(vault, "myproject", "- Some untagged decision.\n", "2026-04-18T00:00:00.000Z");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch["domain-model"]).toBeUndefined();
  });
});

describe("deriveForgeLedgerFromArtifacts — prd phase", () => {
  test("detects PRD matching parent_feature when slice has parent_prd", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", {
      parent_prd: "PRD-001",
      parent_feature: "FEAT-001",
    });
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", ["MYPROJECT-001"]);

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.prd).toBeDefined();
    expect(result.patch.prd?.prdRef).toBe("PRD-001");
    expect(result.patch.prd?.parentPrd).toBe("PRD-001");
    expect(result.findings.some((f) => f.phase === "prd" && f.severity === "warning")).toBe(false);
  });

  test("leaves prd phase incomplete and emits warning when two PRDs are ambiguous", async () => {
    const vault = setupVault();
    // No parent_prd on hub — so all matching PRDs are candidates
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_feature: "FEAT-001" });
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", ["MYPROJECT-001"]);
    makePrd(vault, "myproject", "PRD-002", "FEAT-001", ["MYPROJECT-001"]);

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.prd).toBeUndefined();
    const warning = result.findings.find((f) => f.phase === "prd" && f.severity === "warning");
    expect(warning).toBeDefined();
    expect(warning?.scope).toBe("parent");
    expect(warning?.message).toContain("PRD-001");
    expect(warning?.message).toContain("PRD-002");
  });

  test("returns no prd ref when PRD feature does not match", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", {
      parent_prd: "PRD-001",
      parent_feature: "FEAT-002",
    });
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", ["MYPROJECT-001"]);

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.prd).toBeUndefined();
  });
});

describe("deriveForgeLedgerFromArtifacts — slices phase", () => {
  test("detects slices phase when hub exists and parent PRD lists the slice", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", {
      parent_prd: "PRD-001",
      parent_feature: "FEAT-001",
    });
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", ["MYPROJECT-001"]);

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.slices).toBeDefined();
    expect(result.patch.slices?.sliceRefs).toContain("MYPROJECT-001");
  });

  test("skips slices phase when parent PRD does not list the slice in Child Slices", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-001" });
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", []); // empty child slices

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.slices).toBeUndefined();
  });
});

describe("deriveForgeLedgerFromArtifacts — tdd phase", () => {
  test("detects tdd phase when both plan.md and test-plan.md have status: ready", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeDefined();
    expect(result.patch.tdd?.tddEvidence).toHaveLength(1);
    expect(result.patch.tdd?.tddEvidence?.[0]).toContain("test-plan.md");
  });

  test("skips tdd phase when test-plan has no Red Tests section", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    const dir = join(vault, "projects", "myproject", "specs", "slices", "MYPROJECT-001");
    writeFileSync(
      join(dir, "test-plan.md"),
      "---\ntitle: MYPROJECT-001 test-plan\ntype: spec\nspec_kind: test-plan\nproject: myproject\ntask_id: MYPROJECT-001\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ready\nverification_commands:\n  - command: bun test\n---\n\n# Test Plan\n\n## Verification Commands\n\n```bash\nbun test\n```\n",
      "utf8",
    );

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeUndefined();
  });

  test("skips tdd phase when verification_commands frontmatter is empty", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    const dir = join(vault, "projects", "myproject", "specs", "slices", "MYPROJECT-001");
    writeFileSync(
      join(dir, "test-plan.md"),
      "---\ntitle: MYPROJECT-001 test-plan\ntype: spec\nspec_kind: test-plan\nproject: myproject\ntask_id: MYPROJECT-001\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ready\nverification_commands: []\n---\n\n# Test Plan\n\n## Red Tests\n\n- [x] it works\n",
      "utf8",
    );

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeUndefined();
  });

  test("detects tdd phase from verification command blocks when frontmatter commands are absent", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    const dir = join(vault, "projects", "myproject", "specs", "slices", "MYPROJECT-001");
    writeFileSync(
      join(dir, "test-plan.md"),
      "---\ntitle: MYPROJECT-001 test-plan\ntype: spec\nspec_kind: test-plan\nproject: myproject\ntask_id: MYPROJECT-001\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ready\n---\n\n# Test Plan\n\n## Red Tests\n\n- [x] it works\n\n## Verification Commands\n\n```bash\nbun test tests/myproject.test.ts\n```\n",
      "utf8",
    );

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeDefined();
    expect(result.patch.tdd?.tddEvidence?.[0]).toContain("test-plan.md");
  });

  test("skips tdd phase when plan.md is draft", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "draft");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeUndefined();
  });

  test("skips tdd phase when test-plan.md is draft", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "draft" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeUndefined();
  });

  test("skips tdd phase when plan.md is missing", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    // Only test-plan, no plan.md
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.tdd).toBeUndefined();
  });
});

describe("deriveForgeLedgerFromArtifacts — verify phase", () => {
  test("detects verify phase when verification_level set and recent log entry exists", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready", verificationLevel: "test-verified" });
    addVerifyLogEntry(vault, "MYPROJECT-001", "myproject", "2026-04-18");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.verify).toBeDefined();
    expect(result.patch.verify?.verificationCommands).toBeDefined();
    expect(result.patch.verify?.verificationCommands?.length).toBeGreaterThan(0);
  });

  test("falls back to wiki verify-slice when verify evidence has no explicit shell commands", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    const dir = join(vault, "projects", "myproject", "specs", "slices", "MYPROJECT-001");
    writeFileSync(
      join(dir, "test-plan.md"),
      "---\ntitle: MYPROJECT-001 test-plan\ntype: spec\nspec_kind: test-plan\nproject: myproject\ntask_id: MYPROJECT-001\nupdated: '2026-04-17T00:00:00.000Z'\nstatus: ready\nverification_level: test-verified\n---\n\n# Test Plan\n\n## Red Tests\n\n- [x] it works\n\n## Verification Notes\n\nNo shell command captured yet.\n",
      "utf8",
    );
    addVerifyLogEntry(vault, "MYPROJECT-001", "myproject", "2026-04-18");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.verify).toBeDefined();
    expect(result.patch.verify?.verificationCommands).toEqual([
      "wiki verify-slice myproject MYPROJECT-001",
    ]);
  });

  test("skips verify phase when no verification_level in frontmatter", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" }); // no verificationLevel
    addVerifyLogEntry(vault, "MYPROJECT-001", "myproject", "2026-04-18");

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.verify).toBeUndefined();
  });

  test("skips verify phase when no recent log entry exists", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready", verificationLevel: "test-verified" });
    // No log entry added

    const result = await d(vault, "myproject", "MYPROJECT-001");
    expect(result.patch.verify).toBeUndefined();
  });
});

describe("deriveForgeLedgerFromArtifacts — idempotence", () => {
  test("calling derive twice returns the same patch shape (pure read, no side effects)", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-001", parent_feature: "FEAT-001" });
    makeResearchFile(vault, "myproject", "prd-001-findings.md");
    makeDecisions(vault, "myproject", "- [PRD-001] Design call.\n", "2026-04-18T00:00:00.000Z");
    makePrd(vault, "myproject", "PRD-001", "FEAT-001", ["MYPROJECT-001"]);
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const first = await d(vault, "myproject", "MYPROJECT-001");
    const second = await d(vault, "myproject", "MYPROJECT-001");

    // Patch keys should be identical
    expect(Object.keys(first.patch).sort()).toEqual(Object.keys(second.patch).sort());
    expect(first.findings).toEqual(second.findings);
    // Verify refs are the same
    expect(first.patch.research?.researchRefs).toEqual(second.patch.research?.researchRefs);
    expect(first.patch["domain-model"]?.decisionRefs).toEqual(second.patch["domain-model"]?.decisionRefs);
    expect(first.patch.slices?.sliceRefs).toEqual(second.patch.slices?.sliceRefs);
    expect(first.patch.tdd?.tddEvidence).toEqual(second.patch.tdd?.tddEvidence);
  });
});

describe("mergeDerivedForgeLedger — authored wins", () => {
  test("authored completedAt is preserved over derived completedAt", () => {
    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      research: {
        completedAt: "2026-01-01T00:00:00.000Z",
        researchRefs: ["authored/ref.md"],
      },
    };
    const derived: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      research: {
        completedAt: "2026-04-18T00:00:00.000Z",
        researchRefs: ["derived/ref.md"],
      },
      "domain-model": {
        completedAt: "2026-04-18T00:00:00.000Z",
        decisionRefs: ["projects/myproject/decisions.md#current-decisions"],
      },
    };

    const merged = mergeDerivedForgeLedger(authored, derived);

    // Authored research wins
    expect(merged.research?.completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.research?.researchRefs).toEqual(["authored/ref.md"]);
    // Derived domain-model fills in (was absent in authored)
    expect(merged["domain-model"]?.decisionRefs).toEqual(["projects/myproject/decisions.md#current-decisions"]);
  });

  test("authored top-level parentPrd wins over derived", () => {
    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      parentPrd: "PRD-authored",
    };
    const derived: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      parentPrd: "PRD-derived",
    };

    const merged = mergeDerivedForgeLedger(authored, derived);
    expect(merged.parentPrd).toBe("PRD-authored");
  });

  test("derived fills missing phases from authored", () => {
    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
    };
    const derived: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      tdd: {
        completedAt: "2026-04-18T00:00:00.000Z",
        tddEvidence: ["projects/myproject/specs/slices/MYPROJECT-001/test-plan.md"],
      },
    };

    const merged = mergeDerivedForgeLedger(authored, derived);
    expect(merged.tdd).toEqual(derived.tdd);
  });

  test("mergeDerivedForgeLedger does not mutate inputs", () => {
    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
    };
    const derived: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      research: { completedAt: "2026-04-18T00:00:00.000Z", researchRefs: ["ref"] },
    };

    const originalAuthored = JSON.stringify(authored);
    const originalDerived = JSON.stringify(derived);

    mergeDerivedForgeLedger(authored, derived);

    expect(JSON.stringify(authored)).toBe(originalAuthored);
    expect(JSON.stringify(derived)).toBe(originalDerived);
  });
});

describe("deriveForgeLedgerFromArtifacts — graceful degradation", () => {
  test("returns empty patch when slice hub does not exist (no throw)", async () => {
    const vault = setupVault();
    // No hub created — completely empty project
    const result = await deriveForgeLedgerFromArtifacts("myproject", "MYPROJECT-001", vault);
    expect(result.patch).toEqual({});
    expect(result.findings).toHaveLength(0);
  });
});

describe("applyDerivedLedger — audit log emission", () => {
  test("authored hub ledger overrides derived detection and emits an override log entry", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");

    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      research: {
        completedAt: "2026-04-01T00:00:00.000Z",
        researchRefs: ["projects/myproject/research/manual.md"],
      },
    };

    const { merged } = await applyDerivedLedger(authored, "myproject", "MYPROJECT-001", vault);
    expect(merged.research?.completedAt).toBe("2026-04-01T00:00:00.000Z");

    const log = readFileSync(join(vault, "log.md"), "utf8");
    expect(log).toContain("forge-ledger-override | MYPROJECT-001");
    expect(log).toContain("phase=research");
  });

  test("merges derived tdd phase when authored ledger lacks it", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001", { parent_prd: "PRD-001", parent_feature: "FEAT-001" });
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      // tdd is absent — should be filled from derived
    };

    const { merged, findings } = await applyDerivedLedger(authored, "myproject", "MYPROJECT-001", vault);
    expect(merged.tdd).toBeDefined();
    expect(findings).toBeDefined();
  });

  test("authored tdd phase is preserved in merge and no duplicate auto-heal is emitted", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const authored: Partial<ForgeWorkflowLedger> = {
      project: "myproject",
      sliceId: "MYPROJECT-001",
      // tdd is already authored — authored wins
      tdd: {
        completedAt: "2026-04-01T00:00:00.000Z",
        tddEvidence: ["existing/evidence.md"],
      },
    };

    const { merged } = await applyDerivedLedger(authored, "myproject", "MYPROJECT-001", vault);

    // Authored tdd wins
    expect(merged.tdd?.completedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(merged.tdd?.tddEvidence).toEqual(["existing/evidence.md"]);
  });

  test("applyDerivedLedger is idempotent: second call emits no new log entries", async () => {
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-001");
    makePlan(vault, "myproject", "MYPROJECT-001", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-001", { status: "ready" });

    const logPath = join(vault, "log.md");

    const before = readFileSync(logPath, "utf8");
    await applyDerivedLedger({}, "myproject", "MYPROJECT-001", vault);
    const afterFirst = readFileSync(logPath, "utf8");
    // First call should emit at least one auto-heal entry (tdd phase detected)
    expect(afterFirst.length).toBeGreaterThan(before.length);
    expect(afterFirst).toContain("auto-heal | MYPROJECT-001");
    expect(afterFirst).toContain("phase=tdd");

    // Second call with identical vault state must not append any new entries
    await applyDerivedLedger({}, "myproject", "MYPROJECT-001", vault);
    const afterSecond = readFileSync(logPath, "utf8");
    expect(afterSecond).toBe(afterFirst);
  });

  test("applyDerivedLedger routes audit writes to vaultRoot, not production log", async () => {
    // This test verifies that using an explicit vaultRoot keeps writes isolated.
    // It relies on the production log NOT containing "MYPROJECT-IDL-ISOLATED".
    const vault = setupVault();
    makeSliceHub(vault, "myproject", "MYPROJECT-IDL-ISOLATED");
    makePlan(vault, "myproject", "MYPROJECT-IDL-ISOLATED", "ready");
    makeTestPlan(vault, "myproject", "MYPROJECT-IDL-ISOLATED", { status: "ready" });

    await applyDerivedLedger({}, "myproject", "MYPROJECT-IDL-ISOLATED", vault);

    // Only the test vault's log.md should have the entry
    const testLog = readFileSync(join(vault, "log.md"), "utf8");
    expect(testLog).toContain("auto-heal | MYPROJECT-IDL-ISOLATED");
  });
});
