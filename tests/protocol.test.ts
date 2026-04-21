import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCanonicalProtocolSource,
  renderHandoverAlignmentReminder,
  renderPromptProtocolReminders,
  renderProtocolSurface,
} from "../src/protocol/source";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki protocol commands", () => {
  test("protocol sync installs root files and preserves local notes below the managed block", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    writeFileSync(join(repo, "AGENTS.md"), "# Local Notes\n\nKeep this section.\n", "utf8");

    const result = runWiki(["protocol", "sync", "demo", "--repo", repo, "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.files.some((row: { path: string }) => row.path === "AGENTS.md")).toBe(true);
    expect(json.files.some((row: { path: string }) => row.path === "CLAUDE.md")).toBe(true);

    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(agents).toContain("managed_by: wiki-forge");
    expect(agents).toContain("protocol_version: 2");
    expect(agents).toContain("# Agent Protocol");
    expect(agents).toContain("Do not treat them as separate policy sources");
    expect(agents).toContain("## Code Quality");
    expect(agents).toContain("Codex (GPT-5-class reviewer) reviews every change before it merges");
    expect(agents).toContain("`wiki forge plan demo <feature-name>`");
    expect(agents).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(agents).toContain("`wiki forge next demo`");
    expect(agents).toContain("Workflow Enforcement");
    expect(agents).toContain("# Local Notes");
    expect(claude).toContain("managed_by: wiki-forge");
    expect(claude).toContain("protocol_version: 2");
    expect(claude).toContain("## Code Quality");
    expect(claude).toContain("`wiki forge plan demo <feature-name>`");
    expect(claude).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(claude).toContain("`wiki forge next demo`");
    expect(claude).toContain("wiki protocol sync");
  });

  test("protocol sync and audit support nested scopes declared in _summary frontmatter", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "apps", "api"), { recursive: true });
    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("verification_level: scaffold\n", "verification_level: scaffold\nprotocol_scopes:\n  - apps/api\n"), "utf8");

    expect(runWiki(["protocol", "sync", "demo", "--repo", repo], env).exitCode).toBe(0);
    expect(readFileSync(join(repo, "apps", "api", "AGENTS.md"), "utf8")).toContain("scope: apps/api");
    expect(readFileSync(join(repo, "apps", "api", "CLAUDE.md"), "utf8")).toContain("Scope: apps/api");

    const auditOk = runWiki(["protocol", "audit", "demo", "--repo", repo, "--json"], env);
    expect(auditOk.exitCode).toBe(0);
    expect(JSON.parse(auditOk.stdout.toString()).ok).toBe(true);

    unlinkSync(join(repo, "apps", "api", "CLAUDE.md"));
    const auditFail = runWiki(["protocol", "audit", "demo", "--repo", repo, "--json"], env);
    expect(auditFail.exitCode).toBe(1);
    const auditJson = JSON.parse(auditFail.stdout.toString());
    expect(auditJson.missing.some((row: { path: string }) => row.path === "apps/api/CLAUDE.md")).toBe(true);
  });

  test("onboard with --repo syncs root protocol files", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["onboard", "demo", "--repo", repo], env);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("managed_by: wiki-forge");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain("managed_by: wiki-forge");
  });
});

describe("canonical protocol source", () => {
  test("renders managed protocol surfaces from one canonical source", () => {
    const source = buildCanonicalProtocolSource("demo", { path: ".", scope: "root" });
    const rendered = renderProtocolSurface("demo", { path: ".", scope: "root" });

    expect(source.managedBy).toBe("wiki-forge");
    expect(source.protocolVersion).toBe(2);
    expect(rendered).toContain("managed_by: wiki-forge");
    expect(rendered).toContain(source.workflowLines[0]);
    expect(rendered).toContain("`wiki forge plan demo <feature-name>`");
    expect(rendered).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(rendered).toContain("`wiki forge next demo`");
    expect(rendered).toContain("Workflow Enforcement");
  });

  test("prompt and handover adapters reuse canonical protocol guidance", () => {
    const reminders = renderPromptProtocolReminders("demo");
    const handoverReminder = renderHandoverAlignmentReminder("demo");

    expect(reminders).toContain("Use `/forge` for non-trivial implementation work.");
    expect(reminders.some((line) => line.includes("wiki forge plan demo"))).toBe(true);
    expect(reminders.some((line) => line.includes("wiki forge run demo"))).toBe(true);
    expect(handoverReminder).toContain("load `/wiki` and `/forge` skills before continuing");
  });
});
