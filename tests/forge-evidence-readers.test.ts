import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectDomainModelRefs, detectResearchRefs } from "../src/slice/forge-evidence-readers";
import { cleanupTempPaths, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupVault() {
  const vault = tempDir("forge-evidence-readers-vault");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
  return vault;
}

function makePrd(vault: string, project: string, prdId: string, priorResearchRefs: string[]) {
  const dir = join(vault, "projects", project, "specs", "prds");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${prdId}-test-prd.md`),
    `---\ntitle: ${prdId}\ntype: spec\nspec_kind: prd\nprd_id: ${prdId}\nparent_feature: FEAT-001\nproject: ${project}\nstatus: draft\n---\n\n# ${prdId}\n\n## Prior Research\n\n${priorResearchRefs.map((ref) => `- [[${ref}]]`).join("\n")}\n`,
    "utf8",
  );
}

describe("forge evidence readers", () => {
  test("research detection reads adopted Prior Research refs from the parent PRD", async () => {
    const vault = setupVault();
    makePrd(vault, "demo", "PRD-001", [
      "research/demo/_overview",
      "projects/demo/architecture/reviews/workflow-audit",
    ]);

    const result = await detectResearchRefs("demo", "DEMO-001", "PRD-001", vault);
    expect(result.refs).toEqual([
      "research/demo/_overview",
      "projects/demo/architecture/reviews/workflow-audit",
    ]);
    expect(result.legacyFallbackUsed).toBe(false);
  });

  test("domain-model detection builds section refs from tagged decisions headings", async () => {
    const vault = setupVault();
    const projectDir = join(vault, "projects", "demo");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "decisions.md"),
      "---\ntitle: demo decisions\ntype: notes\nproject: demo\nupdated: '2026-04-18T00:00:00.000Z'\nstatus: current\n---\n\n# Decisions\n\n## [PRD-001] Reader Boundary\n\n- split the evidence readers out.\n",
      "utf8",
    );

    const result = await detectDomainModelRefs("demo", "DEMO-001", "PRD-001", "2026-04-17T00:00:00.000Z", vault);
    expect(result.decisionRefs).toEqual([
      "projects/demo/decisions.md#prd-001-reader-boundary",
    ]);
  });
});
