import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCanonicalProtocolSource,
  renderHandoverAlignmentReminder,
  renderPromptProtocolReminders,
  renderProtocolSurface,
} from "../src/wiki/protocol/source";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki project orientation commands", () => {
  test("scaffold-project rejects non-canonical project names and duplicate slugs", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const spaced = runWiki(["scaffold-project", "Code Forge"], env);
    expect(spaced.exitCode).toBe(1);
    expect(spaced.stderr.toString()).toContain("Use 'code-forge' instead of 'Code Forge'");

    expect(runWiki(["scaffold-project", "code-forge"], env).exitCode).toBe(0);
    mkdirSync(join(vault, "projects", "Code Forge"), { recursive: true });
    const duplicate = runWiki(["scaffold-project", "code-forge"], env);
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr.toString()).toContain("duplicates existing project 'Code Forge'");
  });

  test("project artifact commands refuse unknown projects instead of creating folders", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const moduleResult = runWiki(["create-module", "node", "api"], env);
    expect(moduleResult.exitCode).toBe(1);
    expect(moduleResult.stderr.toString()).toContain("project not found: node");
    expect(existsSync(join(vault, "projects", "node"))).toBe(false);

    const planResult = runWiki(["onboard-plan", "plan", "--write"], env);
    expect(planResult.exitCode).toBe(1);
    expect(planResult.stderr.toString()).toContain("project not found: plan");
    expect(existsSync(join(vault, "projects", "plan"))).toBe(false);
  });

  test("scaffold-project does not create placeholder empty project directories", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["scaffold-project", "demo"], env);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(vault, "projects", "demo", "_summary.md"), "utf8")).toContain("title:");
    const context = readFileSync(join(vault, "projects", "demo", "context.md"), "utf8");
    expect(context).toContain("Canonical project context index");
    expect(context).toContain("[[projects/demo/bugs/BUG-0001-example|BUG-0001]]");
    expect(context).toContain("Symptoms");
    expect(context).toContain("Related Artifacts");
    expect(existsSync(join(vault, "projects", "demo", "modules"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "runbooks"))).toBe(false);
  });

  test("prune-ghost-projects removes activity-only ghost project folders", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    mkdirSync(join(vault, "projects", "plan"), { recursive: true });
    writeFileSync(join(vault, "projects", "plan", ".activity.jsonl"), "{}\n", "utf8");
    const dryRun = runWiki(["prune-ghost-projects", "--json"], env);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.json().removed).toContain("projects/plan");
    expect(existsSync(join(vault, "projects", "plan"))).toBe(true);

    const write = runWiki(["prune-ghost-projects", "--write", "--json"], env);
    expect(write.exitCode).toBe(0);
    expect(write.json().removed).toContain("projects/plan");
    expect(existsSync(join(vault, "projects", "plan"))).toBe(false);
  });

  test("prune-empty-dirs removes old placeholder project directories", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    mkdirSync(join(vault, "projects", "demo", "modules", "empty-module"), { recursive: true });
    mkdirSync(join(vault, "projects", "demo", "runbooks"), { recursive: true });

    const dryRun = runWiki(["prune-empty-dirs", "demo", "--json"], env);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.json().emptyDirs).toContain("projects/demo/modules/empty-module");
    expect(existsSync(join(vault, "projects", "demo", "runbooks"))).toBe(true);

    const write = runWiki(["prune-empty-dirs", "demo", "--write", "--json"], env);
    expect(write.exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "modules"))).toBe(false);
    expect(existsSync(join(vault, "projects", "demo", "runbooks"))).toBe(false);
  });

  test("onboard installs root orientation files and preserves local notes below the managed block", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    writeFileSync(join(repo, "AGENTS.md"), "# Local Notes\n\nKeep this section.\n", "utf8");

    const result = runWiki(["onboard", "demo", "--repo", repo], env);
    expect(result.exitCode).toBe(0);
    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(agents).toContain("managed_by: wiki-forge");
    expect(agents).toContain("orientation_version: 2");
    expect(agents).toContain("# Wiki Project Orientation");
    expect(agents).toContain("Do not treat them as separate policy sources");
    expect(agents).toContain("## Code Quality");
    expect(agents).toContain("Codex (GPT-5-class reviewer) reviews every change before it merges");
    expect(agents).toContain("`wiki forge plan demo <feature-name>`");
    expect(agents).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(agents).toContain("`wiki forge next demo`");
    expect(agents).toContain("Workflow Enforcement");
    expect(agents).toContain("# Local Notes");
    expect(claude).toContain("managed_by: wiki-forge");
    expect(claude).toContain("orientation_version: 2");
    expect(claude).toContain("## Code Quality");
    expect(claude).toContain("`wiki forge plan demo <feature-name>`");
    expect(claude).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(claude).toContain("`wiki forge next demo`");
    expect(claude).toContain("wiki init <project> --repo <path>");
  });

  test("wiki protocol command surface is removed", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const sync = runWiki(["protocol", "sync", "demo", "--repo", repo], env);
    expect(sync.exitCode).toBe(1);
    expect(sync.stderr.toString()).toContain("Unknown command: protocol");
  });

  test("sync supports nested orientation scopes declared in _summary frontmatter", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "apps", "api"), { recursive: true });
    const summaryPath = join(vault, "projects", "demo", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("verification_level: scaffold\n", "verification_level: scaffold\norientation_scopes:\n  - apps/api\n"), "utf8");

    expect(runWiki(["sync", "demo", "--repo", repo, "--write"], env).exitCode).toBe(0);
    expect(readFileSync(join(repo, "apps", "api", "AGENTS.md"), "utf8")).toContain("scope: apps/api");
    expect(readFileSync(join(repo, "apps", "api", "CLAUDE.md"), "utf8")).toContain("Scope: apps/api");

    const syncOk = runWiki(["sync", "demo", "--repo", repo, "--json"], env);
    expect(syncOk.exitCode).toBe(0);
    expect(syncOk.json<{ orientation: { targets: Array<{ path: string; status: string }> } }>().orientation.targets.every((row) => row.status === "ok")).toBe(true);

    unlinkSync(join(repo, "apps", "api", "CLAUDE.md"));
    const syncReport = runWiki(["sync", "demo", "--repo", repo, "--json"], env);
    expect(syncReport.exitCode).toBe(0);
    expect(syncReport.json<{ orientation: { targets: Array<{ path: string; status: string }> } }>().orientation.targets).toContainEqual(expect.objectContaining({ path: "apps/api/CLAUDE.md", status: "missing" }));
  });

  test("onboarding plan does not seed a project legacy folder", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const result = runWiki(["onboard-plan", "demo", "--repo", ".", "--write"], env);

    expect(result.exitCode).toBe(0);
    const plan = readFileSync(join(vault, "projects", "demo", "specs", "onboarding-plan.md"), "utf8");
    expect(plan).not.toContain("Legacy Sources");
    expect(plan).not.toContain("projects/demo/legacy");
  });

  test("onboard with --repo syncs root orientation files", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["onboard", "demo", "--repo", repo], env);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("managed_by: wiki-forge");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain("managed_by: wiki-forge");
  });
});

describe("canonical orientation source", () => {
  test("renders managed orientation surfaces from one canonical source", () => {
    const source = buildCanonicalProtocolSource("demo", { path: ".", scope: "root" });
    const rendered = renderProtocolSurface("demo", { path: ".", scope: "root" });

    expect(source.managedBy).toBe("wiki-forge");
    expect(source.protocolVersion).toBe(2);
    expect(rendered).toContain("orientation_version: 2");
    expect(rendered).toContain("managed_by: wiki-forge");
    expect(rendered).toContain(source.workflowLines[0]);
    expect(rendered).toContain("`wiki forge plan demo <feature-name>`");
    expect(rendered).toContain("`wiki forge run demo [slice-id] --repo <path>`");
    expect(rendered).toContain("`wiki forge next demo`");
    expect(rendered).toContain("Workflow Enforcement");
  });

  test("prompt and handover adapters reuse canonical orientation guidance", () => {
    const reminders = renderPromptProtocolReminders("demo");
    const handoverReminder = renderHandoverAlignmentReminder("demo");

    expect(reminders).toContain("Use `/forge` for non-trivial implementation work.");
    expect(reminders.some((line) => line.includes("wiki forge plan demo"))).toBe(true);
    expect(reminders.some((line) => line.includes("wiki forge run demo"))).toBe(true);
    expect(handoverReminder).toContain("load `/wiki` and `/forge` skills before continuing");
  });
});
