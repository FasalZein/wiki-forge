import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWiki } from "./_helpers/wiki-subprocess";
import { cleanupTempPaths, initVault, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki forge amend", () => {
  test("creates a linked amendment slice without mutating canonical close evidence", () => {
    const vault = tempDir("wiki-vault-amend");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "amendproj"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "amendproj", "closed payments slice", "--source", "src/payments.ts"], env).exitCode).toBe(0);

    const closedHubPath = join(vault, "projects", "amendproj", "specs", "slices", "AMENDPROJ-001", "index.md");
    markSliceCanonicallyClosed(vault, "amendproj", "AMENDPROJ-001", "closed payments slice", ["src/payments.ts"]);
    const amend = runWiki(["forge", "amend", "amendproj", "AMENDPROJ-001", "--reason", "production regression", "--json"], env);
    expect(amend.exitCode).toBe(0);
    const payload = JSON.parse(amend.stdout.toString());
    expect(payload.amendmentSliceId).toBe("AMENDPROJ-002");
    expect(payload.closedSliceId).toBe("AMENDPROJ-001");
    expect(payload.sourcePaths).toEqual(["src/payments.ts"]);

    const closedHubAfterAmend = readFileSync(closedHubPath, "utf8");
    expect(closedHubAfterAmend).toContain("status: done");
    expect(closedHubAfterAmend).toContain("completed_at: 2026-04-13T00:00:00.000Z");
    expect(closedHubAfterAmend).toContain("last_forge_step: close-slice");
    expect(closedHubAfterAmend).toContain("last_forge_state: passed");
    expect(closedHubAfterAmend).toContain("last_forge_ok: true");
    expect(closedHubAfterAmend).not.toContain("amendment_of:");
    expect(closedHubAfterAmend).not.toContain("amendment_reason:");

    const amendmentHubPath = join(vault, "projects", "amendproj", "specs", "slices", "AMENDPROJ-002", "index.md");
    const amendmentPlanPath = join(vault, "projects", "amendproj", "specs", "slices", "AMENDPROJ-002", "plan.md");
    const amendmentTestPlanPath = join(vault, "projects", "amendproj", "specs", "slices", "AMENDPROJ-002", "test-plan.md");
    const amendmentHub = readFileSync(amendmentHubPath, "utf8");
    expect(amendmentHub).toContain("amendment_of: AMENDPROJ-001");
    expect(amendmentHub).toContain("amendment_reason: production regression");
    expect(amendmentHub).toContain("depends_on:\n  - AMENDPROJ-001");
    expect(amendmentHub).toContain("source_paths:\n  - src/payments.ts");
    expect(amendmentHub).toContain("Do not reopen or edit the closed slice");
    expect(readFileSync(amendmentPlanPath, "utf8")).toContain("Preserve the original close evidence");
    expect(readFileSync(amendmentTestPlanPath, "utf8")).toContain("Add regression coverage");

    const backlog = JSON.parse(runWiki(["backlog", "amendproj", "--json"], env).stdout.toString());
    expect(backlog.sections.Done.map((item: { id: string }) => item.id)).toContain("AMENDPROJ-001");
    expect(backlog.sections.Todo.map((item: { id: string }) => item.id)).toContain("AMENDPROJ-002");
  });

  test("can start the amendment slice after linking it to the closed slice", () => {
    const vault = tempDir("wiki-vault-amend-start");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "amendstart"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "amendstart", "closed slice", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    markSliceCanonicallyClosed(vault, "amendstart", "AMENDSTART-001", "closed slice", ["src/payments.ts"]);

    const amend = runWiki(["forge", "amend", "amendstart", "AMENDSTART-001", "--reason", "follow-up bug", "--start", "--agent", "codex", "--json"], env);
    expect(amend.exitCode).toBe(0);
    const payload = JSON.parse(amend.stdout.toString());
    expect(payload.started).toBe(true);
    expect(payload.amendmentSliceId).toBe("AMENDSTART-002");
    expect(typeof payload.startedAt).toBe("string");

    const amendmentHub = readFileSync(join(vault, "projects", "amendstart", "specs", "slices", "AMENDSTART-002", "index.md"), "utf8");
    expect(amendmentHub).toContain("status: in-progress");
    expect(amendmentHub).toContain("claimed_by: codex");
    expect(amendmentHub).toContain("claim_paths:\n  - src/payments.ts");
    const backlog = JSON.parse(runWiki(["backlog", "amendstart", "--json"], env).stdout.toString());
    expect(backlog.sections["In Progress"].map((item: { id: string }) => item.id)).toContain("AMENDSTART-002");
  });

  test("refuses to amend slices without canonical close evidence", () => {
    const vault = tempDir("wiki-vault-open");
    initVault(vault);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "openproj"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "openproj", "open slice"], env).exitCode).toBe(0);

    const amend = runWiki(["forge", "amend", "openproj", "OPENPROJ-001", "--reason", "needs followup"], env);
    expect(amend.exitCode).not.toBe(0);
    expect(amend.stderr.toString()).toContain("slice is not canonically closed");
  });
});

function markSliceCanonicallyClosed(vault: string, project: string, sliceId: string, title: string, sourcePaths: string[]) {
  const closedHubPath = join(vault, "projects", project, "specs", "slices", sliceId, "index.md");
  const closedHubRaw = readFileSync(closedHubPath, "utf8");
  const closedHubContent = closedHubRaw.replace(/^---\n[\s\S]*?\n---\n?/u, "");
  writeFileSync(closedHubPath, [
    "---",
    `title: ${sliceId} ${title}`,
    "type: spec",
    "spec_kind: task-hub",
    `project: ${project}`,
    "source_paths:",
    ...sourcePaths.map((sourcePath) => `  - ${sourcePath}`),
    `task_id: ${sliceId}`,
    "updated: 2026-04-13T00:00:00.000Z",
    "completed_at: 2026-04-13T00:00:00.000Z",
    "status: done",
    "last_forge_run: 2026-04-13T00:00:00.000Z",
    "last_forge_step: close-slice",
    "last_forge_state: passed",
    "last_forge_ok: true",
    "---",
    closedHubContent,
  ].join("\n"), "utf8");
}
