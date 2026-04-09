import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = process.cwd();
const tempPaths: string[] = [];

function tempDir(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempPaths.push(path);
  return path;
}

function runWiki(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runGit(repo: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args.join(" ")} failed`);
  }
  return result;
}

function setupVaultAndRepo() {
  const vault = tempDir("wiki-vault");
  const repo = tempDir("wiki-repo");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "tests", "other.test.ts"), "import { test, expect } from 'bun:test'\ntest('other', () => expect(1).toBe(1))\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
  writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
  writeFileSync(join(repo, "tests", "other.test.ts"), "import { test, expect } from 'bun:test'\ntest('other changed', () => expect(2 - 1).toBe(1))\n", "utf8");
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
  return { vault, repo };
}

function setRepoFrontmatter(vault: string, repo: string) {
  const summaryPath = join(vault, "projects", "demo", "_summary.md");
  const current = readFileSync(summaryPath, "utf8");
  writeFileSync(summaryPath, current.replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");
}

afterEach(() => {
  while (tempPaths.length) {
    const path = tempPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe("wiki CLI smoke", () => {
  test("project maintenance flow works", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const demoBacklogPath = join(vault, "projects", "demo", "backlog.md");
    expect(readFileSync(join(vault, "projects", "demo", "_summary.md"), "utf8")).toContain("> [!summary]");
    expect(readFileSync(demoBacklogPath, "utf8")).toContain("> [!todo]");
    writeFileSync(demoBacklogPath, readFileSync(demoBacklogPath, "utf8").replace("## Cross Links\n\n- [[projects/demo/_summary]]\n- [[projects/demo/specs/index]]\n", "## Cross Links\n\n- [[projects/demo/_summary]]\n"), "utf8");
    expect(runWiki(["create-prd", "demo", "auth workflow"], env).exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "prds", "prd-auth-workflow.md"))).toBe(true);
    expect(runWiki(["add-task", "demo", "stabilize auth", "--priority", "p1", "--tag", "auth"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--priority", "p1", "--tag", "auth"], env).exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-002", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-002", "plan.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices", "DEMO-002", "test-plan.md"))).toBe(true);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["complete-task", "demo", "DEMO-002"], env).exitCode).toBe(0);
    const backlog = runWiki(["backlog", "demo", "--json"], env);
    expect(backlog.exitCode).toBe(0);
    const backlogJson = JSON.parse(backlog.stdout.toString());
    expect(backlogJson.sections["In Progress"][0].id).toBe("DEMO-001");
    expect(backlogJson.sections["Done"][0].id).toBe("DEMO-002");
    expect(readFileSync(demoBacklogPath, "utf8")).toContain("[[projects/demo/_summary]]");
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["verify-page", "demo", "auth", "code-verified"], env).exitCode).toBe(0);

    const status = runWiki(["status", "demo", "--json"], env);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout.toString())[0].project).toBe("demo");

    const verify = runWiki(["verify", "demo", "--json"], env);
    expect(verify.exitCode).toBe(0);
    expect(JSON.parse(verify.stdout.toString()).project).toBe("demo");

    const dashboard = runWiki(["dashboard", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(dashboard.exitCode).toBe(0);
    const dashboardJson = JSON.parse(dashboard.stdout.toString());
    expect(dashboardJson.project).toBe("demo");
    expect(Array.isArray(dashboardJson.recentLog)).toBe(true);

    const drift = runWiki(["drift-check", "demo", "--repo", repo, "--json"], env);
    expect(drift.exitCode).toBe(0);
    expect(JSON.parse(drift.stdout.toString()).project).toBe("demo");

    const summary = runWiki(["summary", "demo", "--repo", repo, "--json"], env);
    expect(summary.exitCode).toBe(0);
    expect(JSON.parse(summary.stdout.toString()).project).toBe("demo");

    const doctor = runWiki(["doctor", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString());
    expect(typeof doctorJson.score).toBe("number");
    expect(Array.isArray(doctorJson.topActions)).toBe(true);
    expect(doctorJson.counts.missingTests).toBe(1);

    const maintain = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(Array.isArray(maintainJson.actions)).toBe(true);
    expect(maintainJson.actions.length).toBeGreaterThan(0);
    expect(maintainJson.refreshFromGit.testHealth.codeFilesWithoutChangedTests).toContain("src/auth.ts");
    expect(maintainJson.actions.some((action: { kind: string; message: string }) => action.kind === "add-tests")).toBe(true);

    const maintainText = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1"], env);
    expect(maintainText.exitCode).toBe(0);
    expect(maintainText.stdout.toString()).toContain("closeout:");
    expect(maintainText.stdout.toString()).toContain("wiki verify-page demo <page...> <level>");

    const refreshFromGit = runWiki(["refresh-from-git", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(refreshFromGit.exitCode).toBe(0);
    const rfgJson = JSON.parse(refreshFromGit.stdout.toString());
    expect(rfgJson.changedFiles).toContain("src/auth.ts");
    expect(rfgJson.impactedPages[0].page).toBe("modules/auth/spec.md");
    expect(Array.isArray(rfgJson.impactedPages[0].diffSummary)).toBe(true);
    expect(rfgJson.testHealth.changedTestFiles).toContain("tests/other.test.ts");
    expect(rfgJson.testHealth.codeFilesWithoutChangedTests).toContain("src/auth.ts");

    const gate = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gate.exitCode).toBe(1);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(gateJson.ok).toBe(false);
    expect(gateJson.counts.missingTests).toBe(1);
    expect(Array.isArray(gateJson.warnings)).toBe(true);
    expect(typeof gateJson.counts.semantic).toBe("number");

    const semantic = runWiki(["lint-semantic", "demo", "--json"], env);
    expect(semantic.exitCode).toBe(1);
    const semanticJson = JSON.parse(semantic.stdout.toString());
    expect(Array.isArray(semanticJson.issues)).toBe(true);

    const discover = runWiki(["discover", "demo", "--repo", repo, "--json"], env);
    expect(discover.exitCode).toBe(0);
    const discoverJson = JSON.parse(discover.stdout.toString());
    expect(discoverJson.repoFiles).toBeGreaterThan(0);
    expect(Array.isArray(discoverJson.unboundPages)).toBe(true);

    const repo2 = tempDir("wiki-repo-uncovered");
    mkdirSync(join(repo2, "src"), { recursive: true });
    writeFileSync(join(repo2, "src", "payments.ts"), "export const x = 1\n", "utf8");
    runGit(repo2, ["init", "-q"]);
    runGit(repo2, ["add", "."]);
    runGit(repo2, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo2, "src", "payments.ts"), "export const x = 2\n", "utf8");
    runGit(repo2, ["add", "."]);
    runGit(repo2, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    const result2 = runWiki(["scaffold-project", "demo2"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result2.exitCode).toBe(0);
    const summary2 = join(vault, "projects", "demo2", "_summary.md");
    writeFileSync(summary2, readFileSync(summary2, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo2}`), "utf8");
    const ingest = runWiki(["ingest-diff", "demo2", "--repo", repo2, "--base", "HEAD~1", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(ingest.exitCode).toBe(0);
    const ingestJson = JSON.parse(ingest.stdout.toString());
    expect(ingestJson.created.length).toBeGreaterThan(0);
    expect(existsSync(join(vault, "projects", "demo2", "modules", "payments", "spec.md"))).toBe(true);

    const updateIndex = runWiki(["update-index", "demo", "--write"], env);
    expect(updateIndex.exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "prds", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "archive", "index.md"))).toBe(true);

    const logTail = runWiki(["log", "tail", "5"], env);
    expect(logTail.exitCode).toBe(0);
    expect(logTail.stdout.toString()).toContain("refresh-from-git");

    // scaffold-research + ingest-research + status
    const scaffoldResearch = runWiki(["research", "scaffold", "projects/demo"], env);
    expect(scaffoldResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "projects", "demo", "_overview.md"))).toBe(true);
    expect(readFileSync(join(vault, "research", "projects", "demo", "_overview.md"), "utf8")).toContain("> [!summary]");

    const ingestResearch = runWiki(["research", "ingest", "projects/demo", "https://example.com/auth"], env);
    expect(ingestResearch.exitCode).toBe(0);
    expect(ingestResearch.stdout.toString()).toContain("research/projects/demo/example-com-auth.md");
    expect(existsSync(join(vault, "research", "projects", "demo", "example-com-auth.md"))).toBe(true);

    const batchIngestResearch = runWiki(["research", "ingest", "projects/demo", "https://example.com/a", "https://example.com/b"], env);
    expect(batchIngestResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "projects", "demo", "example-com-a.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "projects", "demo", "example-com-b.md"))).toBe(true);

    const researchStatus = runWiki(["research", "status", "projects/demo", "--json"], env);
    expect(researchStatus.exitCode).toBe(0);
    const researchStatusJson = JSON.parse(researchStatus.stdout.toString());
    expect(researchStatusJson.topic).toBe("projects/demo");
    expect(researchStatusJson.counts.total).toBeGreaterThanOrEqual(1);

    // file-research
    const research = runWiki(["research", "file", "demo", "auth options comparison"], env);
    expect(research.exitCode).toBe(0);
    expect(research.stdout.toString()).toContain("research/projects/demo/auth-options-comparison.md");
    expect(existsSync(join(vault, "research", "projects", "demo", "auth-options-comparison.md"))).toBe(true);
    const researchContent = readFileSync(join(vault, "research", "projects", "demo", "auth-options-comparison.md"), "utf8");
    expect(researchContent).toContain("type: research");
    expect(researchContent).toContain("project: demo");
    expect(researchContent).toContain("topic: projects/demo");
    expect(researchContent).toContain("verification_level: unverified");
    expect(researchContent).toContain("## TL;DR");
    expect(researchContent).toContain("[[research/projects/demo/_overview]]");
    expect(researchContent).toContain("> [!summary]");

    const sourceFile = join(repo, "notes.txt");
    writeFileSync(sourceFile, "Important source material\n", "utf8");
    const nestedFileResearch = runWiki(["research", "file", "demo", "nested alias check"], env);
    expect(nestedFileResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "projects", "demo", "nested-alias-check.md"))).toBe(true);

    const ingestSourceFile = runWiki(["source", "ingest", sourceFile, "--topic", "projects/demo"], env);
    expect(ingestSourceFile.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "conversations", "notes.txt"))).toBe(true);
    expect(existsSync(join(vault, "research", "projects", "demo", "notes.md"))).toBe(true);
    const ingestedSourceContent = readFileSync(join(vault, "research", "projects", "demo", "notes.md"), "utf8");
    expect(ingestedSourceContent).toContain("[[raw/conversations/notes.txt]]");
    expect(ingestedSourceContent).toContain("> [!summary]");

    unlinkSync(join(vault, "raw", "conversations", "notes.txt"));
    const ingestSourceConflict = runWiki(["source", "ingest", sourceFile, "--topic", "projects/demo"], env);
    expect(ingestSourceConflict.exitCode).toBe(1);
    expect(ingestSourceConflict.stderr.toString()).toContain("research page already exists");
    expect(existsSync(join(vault, "raw", "conversations", "notes.txt"))).toBe(false);

    const ingestSourceUrl = runWiki(["source", "ingest", "https://example.com/paper", "--topic", "projects/demo"], env);
    expect(ingestSourceUrl.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "articles", "example-com-paper.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "projects", "demo", "example-com-paper.md"))).toBe(true);

    const batchSourceA = join(repo, "batch-a.txt");
    const batchSourceB = join(repo, "batch-b.txt");
    writeFileSync(batchSourceA, "batch a\n", "utf8");
    writeFileSync(batchSourceB, "batch b\n", "utf8");
    const batchIngestSource = runWiki(["source", "ingest", batchSourceA, batchSourceB, "--topic", "projects/demo/batch"], env);
    expect(batchIngestSource.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "conversations", "batch-a.txt"))).toBe(true);
    expect(existsSync(join(vault, "raw", "conversations", "batch-b.txt"))).toBe(true);
    expect(existsSync(join(vault, "research", "projects", "demo", "batch", "batch-a.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "projects", "demo", "batch", "batch-b.md"))).toBe(true);

    const lintResearch = runWiki(["research", "lint", "projects/demo", "--json"], env);
    expect(lintResearch.exitCode).toBe(1);
    const lintResearchJson = JSON.parse(lintResearch.stdout.toString());
    expect(Array.isArray(lintResearchJson.issues)).toBe(true);
    expect(lintResearchJson.issues.some((issue: string) => issue.includes("missing sources"))).toBe(true);

    // file-research duplicate fails
    const researchDup = runWiki(["research", "file", "demo", "auth options comparison"], env);
    expect(researchDup.exitCode).toBe(1);
    expect(researchDup.stderr.toString()).toContain("already exists");

    // PRD template includes Prior Research section
    const prdContent = readFileSync(join(vault, "projects", "demo", "specs", "prds", "prd-auth-workflow.md"), "utf8");
    expect(prdContent).toContain("## Prior Research");
    expect(prdContent).toContain("[[research/projects/demo/_overview]]");
  });

  test("forge workflow scaffold chain works end-to-end", () => {
    const vault = tempDir("wiki-vault-forge");
    const repo = tempDir("wiki-repo-forge");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "src", "feature.ts"), "export const feature = () => 'ok'\n", "utf8");
    writeFileSync(join(repo, "tests", "feature.test.ts"), "import { test, expect } from 'bun:test'\ntest('feature', () => expect('ok').toBe('ok'))\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "feature.ts"), "export const feature = () => 'better'\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);

    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "forgey"], env).exitCode).toBe(0);
    const summaryPath = join(vault, "projects", "forgey", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

    expect(runWiki(["research", "file", "forgey", "workflow evidence"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "forgey", "workflow uplift"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "forgey", "workflow slice", "--priority", "p0", "--tag", "forge"], env).exitCode).toBe(0);

    const prdPath = join(vault, "projects", "forgey", "specs", "prds", "prd-workflow-uplift.md");
    const prdContent = readFileSync(prdPath, "utf8");
    expect(prdContent).toContain("[[research/projects/forgey/_overview]]");

    const backlogContent = readFileSync(join(vault, "projects", "forgey", "backlog.md"), "utf8");
    expect(backlogContent).toContain("FORGEY-001");
    const taskIndexPath = join(vault, "projects", "forgey", "specs", "slices", "FORGEY-001", "index.md");
    const planPath = join(vault, "projects", "forgey", "specs", "slices", "FORGEY-001", "plan.md");
    const testPlanPath = join(vault, "projects", "forgey", "specs", "slices", "FORGEY-001", "test-plan.md");
    expect(existsSync(taskIndexPath)).toBe(true);
    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(testPlanPath)).toBe(true);
    const indexPath = join(vault, "projects", "forgey", "specs", "index.md");
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "prds", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "slices", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "archive", "index.md"))).toBe(true);
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("[[projects/forgey/specs/prds/index|PRD Index]]");
    expect(indexContent).toContain("[[projects/forgey/specs/slices/index|Slice Index]]");
    expect(indexContent.indexOf("[[projects/forgey/specs/prds/prd-workflow-uplift|workflow uplift]]")).toBeGreaterThan(-1);
    expect(indexContent.indexOf("[[projects/forgey/specs/slices/FORGEY-001/index|FORGEY-001 workflow slice]]")).toBeGreaterThan(indexContent.indexOf("[[projects/forgey/specs/prds/prd-workflow-uplift|workflow uplift]]"));
    expect(indexContent).not.toContain("[[projects/forgey/specs/slices/FORGEY-001/plan|");
    expect(indexContent).not.toContain("[[projects/forgey/specs/slices/FORGEY-001/test-plan|");
    expect(readFileSync(prdPath, "utf8")).toContain("created_at:");
    expect(readFileSync(planPath, "utf8")).toContain("created_at:");
    expect(readFileSync(testPlanPath, "utf8")).toContain("created_at:");
    expect(readFileSync(prdPath, "utf8")).toContain("> [!summary]");
    expect(readFileSync(planPath, "utf8")).toContain("> [!summary]");
    expect(readFileSync(testPlanPath, "utf8")).toContain("> [!summary]");
    expect(readFileSync(planPath, "utf8")).toContain("[[projects/forgey/specs/index]]");

    expect(runWiki(["create-module", "forgey", "feature", "--source", "src/feature.ts"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "forgey", "specs/prds/prd-workflow-uplift.md", "specs/slices/FORGEY-001/plan.md", "code-verified"], env).exitCode).toBe(0);
    expect(runWiki(["verify-page", "forgey", "feature", "code-verified"], env).exitCode).toBe(0);

    const gate = runWiki(["gate", "forgey", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gate.exitCode).toBe(1);
    expect(JSON.parse(gate.stdout.toString()).counts.missingTests).toBe(1);
  });

  test("gate passes when tests cover changed code", () => {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo-gate-pass");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "src", "payments.ts"), "export const pay = 1\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "test('pay', () => {})\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    // Change both code and its matching test
    writeFileSync(join(repo, "src", "payments.ts"), "export const pay = 2\n", "utf8");
    writeFileSync(join(repo, "tests", "payments.test.ts"), "test('pay v2', () => {})\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "gated"], env).exitCode).toBe(0);
    // Create module and bind source path so the file is covered
    expect(runWiki(["create-module", "gated", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
    const summaryPath = join(vault, "projects", "gated", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

    const gate = runWiki(["gate", "gated", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gate.exitCode).toBe(0);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(gateJson.ok).toBe(true);
    expect(gateJson.counts.missingTests).toBe(0);
    expect(gateJson.blockers).toEqual([]);
    // Uncovered files may appear as warnings, not blockers
    expect(Array.isArray(gateJson.warnings)).toBe(true);
  });

  test("gate reports uncovered files as warnings not blockers", () => {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo-gate-warn");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
    writeFileSync(join(repo, "src", "unbound.ts"), "export const u = 1\n", "utf8");
    writeFileSync(join(repo, "tests", "auth.test.ts"), "test('a', () => {})\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
    writeFileSync(join(repo, "src", "unbound.ts"), "export const u = 2\n", "utf8");
    writeFileSync(join(repo, "tests", "auth.test.ts"), "test('a v2', () => {})\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "warn"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "warn", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    const summaryPath = join(vault, "projects", "warn", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

    const gate = runWiki(["gate", "warn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    // unbound.ts has no test companion — but auth does have one, so missingTests = 1 for unbound.ts
    // However the key point: uncovered files are in warnings, not blockers
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(Array.isArray(gateJson.warnings)).toBe(true);
    expect(gateJson.warnings.some((w: string) => w.includes("not covered by wiki bindings"))).toBe(true);
  });

  test("doctor and gate warn about repo docs that belong in the wiki", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "architecture.md"), "# Architecture\n", "utf8");
    expect(runWiki(["scaffold-project", "docswarn"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "docswarn", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    const summaryPath = join(vault, "projects", "docswarn", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

    const doctor = runWiki(["doctor", "docswarn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString());
    expect(doctorJson.counts.repoDocs).toBeGreaterThan(0);
    expect(doctorJson.topActions.some((action: { kind: string; message: string }) => action.kind === "move-doc-to-wiki")).toBe(true);

    const gate = runWiki(["gate", "docswarn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(Array.isArray(gateJson.warnings)).toBe(true);
    expect(gateJson.warnings.some((warning: string) => warning.includes("repo markdown doc"))).toBe(true);
  });

  test("lint fails for misplaced project docs outside the canonical structure", () => {
    const vault = tempDir("wiki-vault");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");

    expect(runWiki(["scaffold-project", "strict"], env).exitCode).toBe(0);
    mkdirSync(join(vault, "projects", "strict", "notes"), { recursive: true });
    writeFileSync(join(vault, "projects", "strict", "notes", "random.md"), "# Random\n", "utf8");

    const lint = runWiki(["lint", "strict", "--json"], env);
    expect(lint.exitCode).toBe(1);
    const lintJson = JSON.parse(lint.stdout.toString());
    expect(Array.isArray(lintJson.issues)).toBe(true);
    expect(lintJson.issues.some((issue: string) => issue.includes("invalid project doc path"))).toBe(true);
  });

  test("research lint fails for misplaced research docs and unknown raw buckets", () => {
    const vault = tempDir("wiki-vault");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(vault, "projects"), { recursive: true });
    mkdirSync(join(vault, "research"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    writeFileSync(join(vault, "research", "random.md"), "---\ntitle: Random\ntype: research\nsources:\n  - claim: note\n    url: https://example.com\nupdated: 2026-04-09\nverification_level: unverified\n---\n# Random\n\n## Key Findings\n\n- source: [1]\n", "utf8");

    const lint = runWiki(["research", "lint", "--json"], env);
    expect(lint.exitCode).toBe(1);
    const lintJson = JSON.parse(lint.stdout.toString());
    expect(lintJson.issues.some((issue: string) => issue.includes("invalid research path"))).toBe(true);

    const badBucket = runWiki(["source", "ingest", "https://example.com/doc", "--bucket", "books"], env);
    expect(badBucket.exitCode).toBe(1);
    expect(badBucket.stderr.toString()).toContain("unknown raw bucket");
  });

  test("plugin-generated custom layers scaffold and unknown layers fail vault lint", () => {
    const vault = tempDir("wiki-vault");
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");

    const scaffoldLayer = runWiki(["scaffold-layer", "books"], env);
    expect(scaffoldLayer.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "index.md"))).toBe(true);

    const createLayerPage = runWiki(["create-layer-page", "books", "Designing Data Intensive Applications"], env);
    expect(createLayerPage.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "designing-data-intensive-applications.md"))).toBe(true);

    const lintVault = runWiki(["lint-vault", "--json"], env);
    expect(lintVault.exitCode).toBe(0);
    expect(JSON.parse(lintVault.stdout.toString()).issues).toEqual([]);

    mkdirSync(join(vault, "junk"), { recursive: true });
    writeFileSync(join(vault, "junk", "note.md"), "# nope\n", "utf8");
    const badLint = runWiki(["lint-vault", "--json"], env);
    expect(badLint.exitCode).toBe(1);
    expect(JSON.parse(badLint.stdout.toString()).issues.some((issue: string) => issue.includes("unknown top-level layer"))).toBe(true);
  });

  test("grouped research and source commands require subcommands", () => {
    const resultResearch = runWiki(["research"]);
    expect(resultResearch.exitCode).toBe(1);
    expect(resultResearch.stderr.toString()).toContain("missing research subcommand");

    const resultSource = runWiki(["source"]);
    expect(resultSource.exitCode).toBe(1);
    expect(resultSource.stderr.toString()).toContain("missing source subcommand");
  });

  test("help distinguishes research execution from wiki research filing", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("Use the /research skill for actual investigation");
    expect(output).toContain("research file scaffolds a project research note");
    expect(output).toContain("it does not perform the research step");
  });

  test("onboard-plan treats repo research docs as source material and points net-new research to /research", () => {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo-onboard-research");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(repo, "docs", "research"), { recursive: true });
    writeFileSync(join(repo, "docs", "research", "decision.md"), "# Decision\n", "utf8");

    const result = runWiki(["onboard-plan", "demo", "--repo", repo], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("Treat repo-local research docs as source material");
    expect(output).toContain("Run `/research` for any net-new investigation or option comparison");
    expect(output).toContain("File high-signal findings into the vault with `wiki research file demo <topic>`");
  });

  test("legacy flat research commands are rejected", () => {
    const vault = tempDir("wiki-vault");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    const result = runWiki(["file-research", "demo", "old style"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Unknown command");
  });

  test("obsidian wrapper fails clearly when obsidian CLI is unavailable", () => {
    const vault = tempDir("wiki-vault");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    const result = runWiki(["obsidian", "unresolved", "--json"], { KNOWLEDGE_VAULT_ROOT: vault, PATH: "" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("obsidian CLI not found");
  });
});
