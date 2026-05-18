import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditLegacyWorkflowReferences } from "../../src/forge/cleanup/legacy-workflow-audit";
import { cleanupTempPaths, tempDir } from "../test-helpers";

function writeFixture(path: string, content: string): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, content, "utf8");
}

afterEach(() => {
  cleanupTempPaths();
});

describe("legacy workflow reference audit", () => {
  test("finds remaining legacy workflow references and ranks cleanup candidates", () => {
    const audit = auditLegacyWorkflowReferences(process.cwd());

    expect(audit.scannedFiles).toBeGreaterThan(0);
    expect(audit.findings.length).toBeGreaterThan(0);
    expect(audit.candidates.length).toBeGreaterThan(0);
    expect(audit.candidates[0]).toMatchObject({ priority: "high" });
    expect(audit.candidates[0]?.rationale).toContain("highest-value");

    for (const finding of audit.findings) {
      expect(finding.path).not.toContain("node_modules/");
      expect(finding.path).not.toContain(".git/");
      expect(finding.path).not.toContain("/legacy/specs/");
      expect(finding.term).toMatch(/legacy|compat|compatibility|removed|backlog|pipeline|closeout|specs/);
    }
  });

  test("ignores archived workflow material so stale history is not ranked as cleanup work", () => {
    const repo = tempDir("legacy-workflow-audit");
    writeFixture(join(repo, "src", "active.ts"), "export const backlogCompatibility = true;\n");
    writeFixture(join(repo, "archive", "old-pipeline.md"), "legacy pipeline specs backlog compatibility\n");
    writeFixture(join(repo, "specs", "archive", "old-closeout.md"), "removed closeout specs backlog\n");

    const audit = auditLegacyWorkflowReferences(repo);

    expect([...new Set(audit.findings.map((finding) => finding.path))]).toEqual(["src/active.ts"]);
    expect(audit.candidates.map((candidate) => candidate.path)).toEqual(["src/active.ts"]);
  });
});
