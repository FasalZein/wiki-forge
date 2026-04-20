import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runGit, runWiki, setRepoFrontmatter, setupVaultAndRepo, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki CLI smoke", () => {
  test("project scaffolding creates features, PRDs, and slices", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    const demoBacklogPath = join(vault, "projects", "demo", "backlog.md");
    expect(readFileSync(join(vault, "projects", "demo", "_summary.md"), "utf8")).toContain("> [!summary]");
    expect(readFileSync(demoBacklogPath, "utf8")).toContain("> [!todo]");
    writeFileSync(demoBacklogPath, readFileSync(demoBacklogPath, "utf8").replace("## Cross Links\n\n- [[projects/demo/_summary]]\n- [[projects/demo/specs/index]]\n", "## Cross Links\n\n- [[projects/demo/_summary]]\n"), "utf8");
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "features", "FEAT-001-auth-platform.md"))).toBe(true);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "prds", "PRD-001-auth-workflow.md"))).toBe(true);
    expect(runWiki(["create-plan", "demo", "auth rollout"], env).exitCode).toBe(0);
    expect(runWiki(["create-test-plan", "demo", "auth rollout"], env).exitCode).toBe(0);
    const planningIndexContent = readFileSync(join(vault, "projects", "demo", "specs", "index.md"), "utf8");
    expect(planningIndexContent).toContain("[[projects/demo/specs/plan-auth-rollout|auth rollout]]");
    expect(planningIndexContent).toContain("[[projects/demo/specs/test-plan-auth-rollout|auth rollout]]");
    expect(runWiki(["add-task", "demo", "stabilize auth", "--priority", "p1", "--tag", "auth"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--priority", "p1", "--tag", "auth", "--prd", "PRD-001"], env).exitCode).toBe(0);
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

    // PRD template includes Prior Research section
    const prdContent = readFileSync(join(vault, "projects", "demo", "specs", "prds", "PRD-001-auth-workflow.md"), "utf8");
    expect(prdContent).toContain("## Prior Research");
    expect(prdContent).toContain("[[research/demo/_overview]]");
  });

  test("module and binding commands work", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/slices/DEMO-001/index.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["update-index", "demo", "--write"], env).exitCode).toBe(0);
    const featureContent = readFileSync(join(vault, "projects", "demo", "specs", "features", "FEAT-001-auth-platform.md"), "utf8");
    expect(featureContent).toContain("PRD-001 auth workflow");
    expect(featureContent).toContain("DEMO-001 auth slice");
    const prdLinkedContent = readFileSync(join(vault, "projects", "demo", "specs", "prds", "PRD-001-auth-workflow.md"), "utf8");
    expect(prdLinkedContent).toContain("FEAT-001 auth platform");
    expect(prdLinkedContent).toContain("DEMO-001 auth slice");
    expect(prdLinkedContent).toContain("Auth Module");
    const moduleContent = readFileSync(join(vault, "projects", "demo", "modules", "auth", "spec.md"), "utf8");
    expect(moduleContent).toContain("## Related Planning");
    expect(moduleContent).toContain("FEAT-001 auth platform");
    expect(moduleContent).toContain("PRD-001 auth workflow");
    expect(moduleContent).toContain("DEMO-001 auth slice");
    const architecturePath = join(vault, "projects", "demo", "architecture", "auth-context.md");
    mkdirSync(join(vault, "projects", "demo", "architecture"), { recursive: true });
    writeFileSync(architecturePath, "---\ntitle: Auth Context\ntype: notes\nproject: demo\nupdated: 2026-04-10\nstatus: current\nverification_level: code-verified\nsource_paths:\n  - src/auth.ts\n---\n\n# Auth Context\n\n## Cross Links\n\n- [[projects/demo/_summary]]\n", "utf8");
    expect(runWiki(["update-index", "demo", "--write"], env).exitCode).toBe(0);
    const architectureContent = readFileSync(architecturePath, "utf8");
    expect(architectureContent).toContain("## Related Modules");
    expect(architectureContent).toContain("Auth Module");
    expect(architectureContent).toContain("## Related Planning");
    expect(architectureContent).toContain("FEAT-001 auth platform");
    expect(architectureContent).toContain("PRD-001 auth workflow");
    expect(architectureContent).toContain("DEMO-001 auth slice");
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["verify-page", "demo", "auth", "code-verified"], env).exitCode).toBe(0);

    // update-index creates all navigation indexes
    const updateIndex = runWiki(["update-index", "demo", "--write"], env);
    expect(updateIndex.exitCode).toBe(0);
    expect(existsSync(join(vault, "projects", "demo", "specs", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "features", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "prds", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "slices", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "demo", "specs", "archive", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "_dashboard.md"))).toBe(true);
    const workspaceDashboardContent = readFileSync(join(vault, "projects", "_dashboard.md"), "utf8");
    expect(workspaceDashboardContent).toContain("[[projects/demo/_summary|demo]]");
    expect(workspaceDashboardContent).toContain("[[projects/demo/backlog|backlog]]");
    expect(workspaceDashboardContent).toContain("[[projects/demo/specs/index|specs]]");
    const rootIndexContent = readFileSync(join(vault, "index.md"), "utf8");
    expect(rootIndexContent).toContain("[[projects/_dashboard|Project Dashboard]]");
    expect(rootIndexContent).toContain("[[projects/demo/_summary|demo]]");
  });

  test("maintenance pipeline produces valid reports", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "demo", "DEMO-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/slices/DEMO-001/index.md", "src/auth.ts"], env).exitCode).toBe(0);
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
    const driftJson = JSON.parse(drift.stdout.toString());
    expect(driftJson.project).toBe("demo");
    expect(driftJson.totalWikiPages).toBe(dashboardJson.status.pages);
    expect(driftJson.unboundPages.length).toBe(dashboardJson.status.unbound);

    const summary = runWiki(["summary", "demo", "--repo", repo, "--json"], env);
    expect(summary.exitCode).toBe(0);
    const summaryJson = JSON.parse(summary.stdout.toString());
    expect(summaryJson.project).toBe("demo");
    expect(summaryJson.status.pages).toBe(summaryJson.verify.pages);
    expect(summaryJson.status.unbound).toBe(driftJson.unboundPages.length);
    expect(summaryJson.focus.activeTask.id).toBe("DEMO-001");

    const doctor = runWiki(["doctor", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString());
    expect(typeof doctorJson.score).toBe("number");
    expect(Array.isArray(doctorJson.topActions)).toBe(true);
    expect(doctorJson.counts.missingTests).toBe(1);
    expect(doctorJson.focus.activeTask.id).toBe("DEMO-001");
    expect(doctorJson.focus.activeTask.id).toBe(doctorJson.maintain.focus.activeTask.id);
    expect(doctorJson.status.pages).toBe(doctorJson.verify.pages);
    expect(doctorJson.status.bound + doctorJson.status.unbound).toBe(doctorJson.status.pages);

    const maintain = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());
    expect(Array.isArray(maintainJson.actions)).toBe(true);
    expect(maintainJson.actions.length).toBeGreaterThan(0);
    expect(maintainJson.focus.activeTask.id).toBe("DEMO-001");
    expect(maintainJson.refreshFromGit.testHealth.codeFilesWithoutChangedTests).toContain("src/auth.ts");
    expect(maintainJson.actions.some((action: { kind: string; message: string }) => action.kind === "active-task")).toBe(true);
    expect(maintainJson.actions.some((action: { kind: string; message: string }) => action.kind === "add-tests")).toBe(true);
    expect(doctorJson.maintain.discover.uncoveredFiles).toEqual(maintainJson.discover.uncoveredFiles);

    const maintainText = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1"], env);
    expect(maintainText.exitCode).toBe(0);
    expect(maintainText.stdout.toString()).toContain("active task: DEMO-001");
    // WIKI-FORGE-102: closeout reminder block is gated behind --verbose by default
    expect(maintainText.stdout.toString()).not.toContain("wiki verify-page demo <page...> <level>");
    const maintainVerbose = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1", "--verbose"], env);
    expect(maintainVerbose.exitCode).toBe(0);
    expect(maintainVerbose.stdout.toString()).toContain("closeout:");
    expect(maintainVerbose.stdout.toString()).toContain("wiki verify-page demo <page...> <level>");
    // WIKI-FORGE-106: when closeout state is clean, nextSteps is empty and status is "PASS — ready to close"
    const cleanCloseout = runWiki(["closeout", "demo", "--repo", repo, "--base", "HEAD"], env);
    expect(cleanCloseout.exitCode).toBe(0);
    expect(cleanCloseout.stdout.toString()).toContain("PASS — ready to close");
    expect(cleanCloseout.stdout.toString()).not.toContain("manual steps before closing");

    const refreshFromGit = runWiki(["refresh-from-git", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(refreshFromGit.exitCode).toBe(0);
    const rfgJson = JSON.parse(refreshFromGit.stdout.toString());
    expect(rfgJson.changedFiles).toContain("src/auth.ts");
    expect(rfgJson.impactedPages[0].page).toBe("modules/auth/spec.md");
    const authImpactedPages = rfgJson.impactedPages.filter((page: { matchedSourcePaths: string[] }) => page.matchedSourcePaths.includes("src/auth.ts"));
    expect(authImpactedPages.length).toBeGreaterThan(1);
    expect(rfgJson.testHealth.changedTestFiles).toContain("tests/other.test.ts");
    expect(rfgJson.testHealth.codeFilesWithoutChangedTests).toContain("src/auth.ts");
  });

  test("verification and gate validate project health", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "demo", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "demo", "specs/slices/DEMO-001/index.md", "src/auth.ts"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["verify-page", "demo", "auth", "code-verified"], env).exitCode).toBe(0);

    const gate = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(gate.exitCode).toBe(1);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(gateJson.ok).toBe(false);
    expect(gateJson.counts.missingTests).toBe(1);
    expect(Array.isArray(gateJson.warnings)).toBe(true);
    expect(typeof gateJson.counts.semantic).toBe("number");
    expect(gateJson.doctor.status.pages).toBe(gateJson.doctor.verify.pages);

    const semantic = runWiki(["lint-semantic", "demo", "--json"], env);
    expect(semantic.exitCode).toBe(1);
    const semanticJson = JSON.parse(semantic.stdout.toString());
    expect(Array.isArray(semanticJson.issues)).toBe(true);

    const maintain = runWiki(["maintain", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(maintain.exitCode).toBe(0);
    const maintainJson = JSON.parse(maintain.stdout.toString());

    const discover = runWiki(["discover", "demo", "--repo", repo, "--json"], env);
    expect(discover.exitCode).toBe(0);
    const discoverJson = JSON.parse(discover.stdout.toString());
    expect(discoverJson.repoFiles).toBeGreaterThan(0);
    expect(Array.isArray(discoverJson.unboundPages)).toBe(true);
    expect(discoverJson.uncoveredFiles).toEqual(maintainJson.discover.uncoveredFiles);
    expect(discoverJson.unboundPages).toEqual(maintainJson.discover.unboundPages);

    const discoverTree = runWiki(["discover", "demo", "--repo", repo, "--json", "--tree"], env);
    expect(discoverTree.exitCode).toBe(0);
    expect(Array.isArray(JSON.parse(discoverTree.stdout.toString()).tree)).toBe(true);

    expect(gateJson.doctor.maintain.discover.uncoveredFiles).toEqual(maintainJson.discover.uncoveredFiles);
  });

  test("research filing and source ingestion work", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);

    // scaffold-research + ingest-research + status
    const scaffoldResearch = runWiki(["research", "scaffold", "demo"], env);
    expect(scaffoldResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "demo", "_overview.md"))).toBe(true);
    expect(readFileSync(join(vault, "research", "demo", "_overview.md"), "utf8")).toContain("> [!summary]");

    const ingestResearch = runWiki(["research", "ingest", "demo", "https://example.com/auth"], env);
    expect(ingestResearch.exitCode).toBe(0);
    expect(ingestResearch.stdout.toString()).toContain("research/demo/example-com-auth.md");
    expect(existsSync(join(vault, "research", "demo", "example-com-auth.md"))).toBe(true);

    const batchIngestResearch = runWiki(["research", "ingest", "demo", "https://example.com/a", "https://example.com/b"], env);
    expect(batchIngestResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "demo", "example-com-a.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "demo", "example-com-b.md"))).toBe(true);

    const researchStatus = runWiki(["research", "status", "demo", "--json"], env);
    expect(researchStatus.exitCode).toBe(0);
    const researchStatusJson = JSON.parse(researchStatus.stdout.toString());
    expect(researchStatusJson.topic).toBe("demo");
    expect(researchStatusJson.counts.total).toBeGreaterThanOrEqual(1);
    expect(researchStatusJson.workflow.byStage.capture).toBeGreaterThanOrEqual(0);

    // file-research
    const research = runWiki(["research", "file", "demo", "--project", "demo", "auth options comparison"], env);
    expect(research.exitCode).toBe(0);
    expect(research.stdout.toString()).toContain("research/demo/auth-options-comparison.md");
    expect(existsSync(join(vault, "research", "demo", "auth-options-comparison.md"))).toBe(true);
    const researchContent = readFileSync(join(vault, "research", "demo", "auth-options-comparison.md"), "utf8");
    expect(researchContent).toContain("type: research");
    expect(researchContent).toContain("project: demo");
    expect(researchContent).toContain("topic: demo");
    expect(researchContent).toContain("verification_level: unverified");
    expect(researchContent).toContain("## TL;DR");
    expect(researchContent).toContain("[[research/demo/_overview]]");
    expect(researchContent).toContain("> [!summary]");

    const verifiedResearch = researchContent
      .replace("status: draft", "status: verified")
      .replace("verification_level: unverified", "verification_level: source-checked");
    writeFileSync(join(vault, "research", "demo", "auth-options-comparison.md"), verifiedResearch, "utf8");
    const distillResearch = runWiki(["research", "distill", "research/demo/auth-options-comparison", "projects/demo/decisions", "--json"], env);
    expect(distillResearch.exitCode).toBe(0);
    const distillResearchJson = JSON.parse(distillResearch.stdout.toString());
    expect(distillResearchJson.applied).toBe(true);
    expect(distillResearchJson.target).toBe("projects/demo/decisions");
    const distilledResearchContent = readFileSync(join(vault, "research", "demo", "auth-options-comparison.md"), "utf8");
    expect(distilledResearchContent).toContain("status: applied");
    expect(distilledResearchContent).toContain("projects/demo/decisions");

    const nestedFileResearch = runWiki(["research", "file", "demo", "--project", "demo", "nested alias check"], env);
    expect(nestedFileResearch.exitCode).toBe(0);
    expect(existsSync(join(vault, "research", "demo", "nested-alias-check.md"))).toBe(true);

    // source ingest
    const sourceFile = join(repo, "notes.txt");
    writeFileSync(sourceFile, "Important source material\n", "utf8");
    const ingestSourceFile = runWiki(["source", "ingest", sourceFile, "--topic", "demo"], env);
    expect(ingestSourceFile.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "conversations", "notes.txt"))).toBe(true);
    expect(existsSync(join(vault, "research", "demo", "notes.md"))).toBe(true);
    const ingestedSourceContent = readFileSync(join(vault, "research", "demo", "notes.md"), "utf8");
    expect(ingestedSourceContent).toContain("[[raw/conversations/notes.txt]]");
    expect(ingestedSourceContent).toContain("> [!summary]");

    unlinkSync(join(vault, "raw", "conversations", "notes.txt"));
    const ingestSourceConflict = runWiki(["source", "ingest", sourceFile, "--topic", "demo"], env);
    expect(ingestSourceConflict.exitCode).toBe(1);
    expect(ingestSourceConflict.stderr.toString()).toContain("research page already exists");
    expect(existsSync(join(vault, "raw", "conversations", "notes.txt"))).toBe(false);

    const ingestSourceUrl = runWiki(["source", "ingest", "https://example.com/paper", "--topic", "demo"], env);
    expect(ingestSourceUrl.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "articles", "example-com-paper.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "demo", "example-com-paper.md"))).toBe(true);

    const batchSourceA = join(repo, "batch-a.txt");
    const batchSourceB = join(repo, "batch-b.txt");
    writeFileSync(batchSourceA, "batch a\n", "utf8");
    writeFileSync(batchSourceB, "batch b\n", "utf8");
    const batchIngestSource = runWiki(["source", "ingest", batchSourceA, batchSourceB, "--topic", "demo/batch"], env);
    expect(batchIngestSource.exitCode).toBe(0);
    expect(existsSync(join(vault, "raw", "conversations", "batch-a.txt"))).toBe(true);
    expect(existsSync(join(vault, "raw", "conversations", "batch-b.txt"))).toBe(true);
    expect(existsSync(join(vault, "research", "demo", "batch", "batch-a.md"))).toBe(true);
    expect(existsSync(join(vault, "research", "demo", "batch", "batch-b.md"))).toBe(true);

    const lintResearch = runWiki(["research", "lint", "demo", "--json"], env);
    expect(lintResearch.exitCode).toBe(1);
    const lintResearchJson = JSON.parse(lintResearch.stdout.toString());
    expect(Array.isArray(lintResearchJson.issues)).toBe(true);
    expect(lintResearchJson.issues.some((issue: string) => issue.includes("missing sources"))).toBe(true);

    // file-research duplicate fails
    const researchDup = runWiki(["research", "file", "demo", "--project", "demo", "auth options comparison"], env);
    expect(researchDup.exitCode).toBe(1);
    expect(researchDup.stderr.toString()).toContain("already exists");
  });

  test("log and ingest-diff commands produce output", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-module", "demo", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    // Run a command that writes to the log
    expect(runWiki(["refresh-from-git", "demo", "--repo", repo, "--base", "HEAD~1"], env).exitCode).toBe(0);

    const logTail = runWiki(["log", "tail", "5"], env);
    expect(logTail.exitCode).toBe(0);
    expect(logTail.stdout.toString()).toContain("refresh-from-git");

    // ingest-diff with a separate repo
    const uncoveredRepo = tempDir("wiki-repo-uncovered");
    mkdirSync(join(uncoveredRepo, "src"), { recursive: true });
    writeFileSync(join(uncoveredRepo, "src", "payments.ts"), "export const x = 1\n", "utf8");
    runGit(uncoveredRepo, ["init", "-q"]);
    runGit(uncoveredRepo, ["add", "."]);
    runGit(uncoveredRepo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(uncoveredRepo, "src", "payments.ts"), "export const x = 2\n", "utf8");
    runGit(uncoveredRepo, ["add", "."]);
    runGit(uncoveredRepo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    const scaffoldDemo2 = runWiki(["scaffold-project", "demo2"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(scaffoldDemo2.exitCode).toBe(0);
    const demo2SummaryPath = join(vault, "projects", "demo2", "_summary.md");
    writeFileSync(demo2SummaryPath, readFileSync(demo2SummaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${uncoveredRepo}`), "utf8");
    const ingest = runWiki(["ingest-diff", "demo2", "--repo", uncoveredRepo, "--base", "HEAD~1", "--json"], { KNOWLEDGE_VAULT_ROOT: vault });
    expect(ingest.exitCode).toBe(0);
    const ingestJson = JSON.parse(ingest.stdout.toString());
    expect(ingestJson.created.length).toBeGreaterThan(0);
    expect(existsSync(join(vault, "projects", "demo2", "modules", "payments", "spec.md"))).toBe(true);
  });

  test("workspace dashboard and root index refresh from real project state", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "alpha"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo, "alpha");
    expect(runWiki(["create-feature", "alpha", "workspace nav"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "alpha", "--feature", "FEAT-001", "root views"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "alpha", "dashboard slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    let dashboardContent = readFileSync(join(vault, "projects", "_dashboard.md"), "utf8");
    let rootIndexContent = readFileSync(join(vault, "index.md"), "utf8");
    expect(dashboardContent).toContain("[[projects/alpha/_summary|alpha]]");
    expect(dashboardContent).toContain("ALPHA-001 dashboard slice");
    expect(rootIndexContent).toContain("[[projects/alpha/_summary|alpha]]");
    expect(rootIndexContent).not.toContain("[[projects/beta/_summary|beta]]");

    expect(runWiki(["scaffold-project", "beta"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "beta", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["update-index", "beta", "--write"], env).exitCode).toBe(0);

    dashboardContent = readFileSync(join(vault, "projects", "_dashboard.md"), "utf8");
    rootIndexContent = readFileSync(join(vault, "index.md"), "utf8");
    expect(dashboardContent).toContain("[[projects/alpha/_summary|alpha]]");
    expect(dashboardContent).toContain("[[projects/beta/_summary|beta]]");
    expect(dashboardContent).toContain("[[projects/beta/backlog|backlog]]");
    expect(rootIndexContent).toContain("[[projects/_dashboard|Project Dashboard]]");
    expect(rootIndexContent).toContain("[[projects/beta/_summary|beta]]");

    expect(runWiki(["start-slice", "alpha", "ALPHA-001", "--agent", "pi", "--repo", repo], env).exitCode).toBe(0);
    expect(runWiki(["update-index", "alpha", "--write"], env).exitCode).toBe(0);
    dashboardContent = readFileSync(join(vault, "projects", "_dashboard.md"), "utf8");
    expect(dashboardContent).toContain("ALPHA-001 dashboard slice");
  });

  test("create-issue-slice inherits source_paths from parent prd", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "autobind"], env).exitCode).toBe(0);
    expect(runWiki(["create-feature", "autobind", "auth platform"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "autobind", "--feature", "FEAT-001", "auth workflow"], env).exitCode).toBe(0);
    expect(runWiki(["bind", "autobind", "specs/prds/PRD-001-auth-workflow.md", "src/auth.ts"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "autobind", "auth slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const taskDir = join(vault, "projects", "autobind", "specs", "slices", "AUTOBIND-001");
    expect(readFileSync(join(taskDir, "index.md"), "utf8")).toContain("src/auth.ts");
    expect(readFileSync(join(taskDir, "plan.md"), "utf8")).toContain("src/auth.ts");
    expect(readFileSync(join(taskDir, "test-plan.md"), "utf8")).toContain("src/auth.ts");
  });

  test("bind supports merge mode without dropping existing source_paths", () => {
    const { vault } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "bindmode"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "bindmode", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);

    const modulePath = join(vault, "projects", "bindmode", "modules", "auth", "spec.md");
    expect(readFileSync(modulePath, "utf8")).toContain("src/auth.ts");

    expect(runWiki(["bind", "bindmode", "modules/auth/spec.md", "src/replaced.ts"], env).exitCode).toBe(0);
    const replaced = readFileSync(modulePath, "utf8");
    expect(replaced).toContain("src/replaced.ts");
    expect(replaced).not.toContain("src/auth.ts");

    const dryRun = runWiki(["bind", "bindmode", "modules/auth/spec.md", "--mode", "merge", "src\\replaced.ts", " src/auth.ts ", "src/extra.ts", "--dry-run"], env);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout.toString()).toContain("source_paths: src/replaced.ts, src/auth.ts, src/extra.ts");

    expect(runWiki(["bind", "bindmode", "modules/auth/spec.md", "--mode", "merge", "src\\replaced.ts", " src/auth.ts ", "src/extra.ts"], env).exitCode).toBe(0);
    const merged = readFileSync(modulePath, "utf8");
    expect(merged).toContain("source_paths:");
    expect(merged).toContain("  - src/replaced.ts\n  - src/auth.ts\n  - src/extra.ts");

    const rerun = runWiki(["bind", "bindmode", "modules/auth/spec.md", "--mode", "merge", "src/replaced.ts", "src/auth.ts", "src/extra.ts"], env);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.toString()).toContain("source_paths already current");
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
    expect(runWiki(["create-feature", "forgey", "workflow hardening"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "forgey", "--feature", "FEAT-001", "workflow uplift"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "forgey", "workflow slice", "--priority", "p0", "--tag", "forge", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const prdPath = join(vault, "projects", "forgey", "specs", "prds", "PRD-001-workflow-uplift.md");
    const prdContent = readFileSync(prdPath, "utf8");
    expect(prdContent).toContain("[[research/forgey/_overview]]");

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
    expect(existsSync(join(vault, "projects", "forgey", "specs", "features", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "prds", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "slices", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "projects", "forgey", "specs", "archive", "index.md"))).toBe(true);
    const indexContent = readFileSync(indexPath, "utf8");
    expect(indexContent).toContain("[[projects/forgey/specs/features/index|Feature Index]]");
    expect(indexContent).toContain("[[projects/forgey/specs/prds/index|PRD Index]]");
    expect(indexContent).toContain("[[projects/forgey/specs/slices/index|Slice Index]]");
    expect(indexContent.indexOf("[[projects/forgey/specs/features/FEAT-001-workflow-hardening|FEAT-001 workflow hardening]]")).toBeGreaterThan(-1);
    expect(indexContent.indexOf("[[projects/forgey/specs/prds/PRD-001-workflow-uplift|PRD-001 workflow uplift]]")).toBeGreaterThan(-1);
    expect(indexContent.indexOf("[[projects/forgey/specs/slices/FORGEY-001/index|FORGEY-001 workflow slice]]")).toBeGreaterThan(indexContent.indexOf("[[projects/forgey/specs/prds/PRD-001-workflow-uplift|PRD-001 workflow uplift]]"));
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
    expect(runWiki(["verify-page", "forgey", "specs/features/FEAT-001-workflow-hardening.md", "specs/prds/PRD-001-workflow-uplift.md", "specs/slices/FORGEY-001/plan.md", "code-verified"], env).exitCode).toBe(0);
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

  test("doctor warns about invalid backlog state", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "backlogwarn"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "backlogwarn", "first slice"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "backlogwarn", "second slice"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "backlogwarn", "BACKLOGWARN-001", "--to", "In Progress"], env).exitCode).toBe(0);
    expect(runWiki(["move-task", "backlogwarn", "BACKLOGWARN-002", "--to", "In Progress"], env).exitCode).toBe(0);

    const doctor = runWiki(["doctor", "backlogwarn", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString());
    expect(doctorJson.focus.activeTask.id).toBe("BACKLOGWARN-002");
    expect(doctorJson.counts.backlogWarnings).toBeGreaterThan(0);
    expect(doctorJson.backlogWarnings.some((warning: string) => warning.includes("multiple tasks are in progress"))).toBe(true);
    expect(doctorJson.backlogWarnings.some((warning: string) => warning.includes("plan is incomplete"))).toBe(true);
    expect(doctorJson.backlogWarnings.some((warning: string) => warning.includes("test-plan is incomplete"))).toBe(true);
  });

  test("doctor and gate warn about repo docs that belong in the wiki", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "skills", "local-skill"), { recursive: true });
    writeFileSync(join(repo, "docs", "architecture.md"), "# Architecture\n", "utf8");
    writeFileSync(join(repo, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(repo, "SETUP.md"), "# Setup\n", "utf8");
    writeFileSync(join(repo, "skills", "local-skill", "SKILL.md"), "# Skill\n", "utf8");
    expect(runWiki(["scaffold-project", "docswarn"], env).exitCode).toBe(0);
    expect(runWiki(["create-module", "docswarn", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
    const summaryPath = join(vault, "projects", "docswarn", "_summary.md");
    writeFileSync(summaryPath, readFileSync(summaryPath, "utf8").replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

    const doctor = runWiki(["doctor", "docswarn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(doctor.stdout.toString());
    expect(doctorJson.counts.repoDocs).toBe(1);
    expect(doctorJson.topActions.some((action: { kind: string; message: string }) => action.kind === "move-doc-to-wiki")).toBe(true);

    const gate = runWiki(["gate", "docswarn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const gateJson = JSON.parse(gate.stdout.toString());
    expect(Array.isArray(gateJson.warnings)).toBe(true);
    expect(gateJson.warnings.some((warning: string) => warning.includes("repo markdown doc"))).toBe(true);

    unlinkSync(join(repo, "docs", "architecture.md"));
    const doctorAfterDelete = runWiki(["doctor", "docswarn", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    expect(doctorAfterDelete.exitCode).toBe(0);
    const doctorAfterDeleteJson = JSON.parse(doctorAfterDelete.stdout.toString());
    expect(doctorAfterDeleteJson.counts.repoDocs).toBe(0);
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

  test("help lists all major command groups and key commands", () => {
    const result = runWiki(["help"]);
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("wiki research audit [topic] [--json]");
    expect(output).toContain("wiki closeout <project> [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json] [--verbose]");
    expect(output).toContain("wiki backlog <project> [--assignee <agent>] [--json]");
    expect(output).toContain("wiki create-issue-slice <project> <title...> [--section <name>] [--priority <p>] [--tag <t>] [--prd <PRD-ID>] [--assignee <agent>] [--source <path...>] [--json]");
    expect(output).toContain("wiki commit-check <project> [--repo <path>] [--json] [--verbose]");
    expect(output).toContain("wiki checkpoint <project> [--repo <path>] [--base <rev>] [--json]");
    expect(output).toContain("wiki lint-repo <project> [--repo <path>] [--json]");
    expect(output).toContain("wiki protocol sync <project> [--repo <path>] [--json]");
    expect(output).toContain("wiki protocol audit <project> [--repo <path>] [--json]");
    expect(output).toContain("wiki install-git-hook <project> [--repo <path>] [--hook <name>] [--force] [--json]");
    expect(output).toContain("wiki close-feature <project> <FEAT-ID> [--force] [--yes-really-force]");
    expect(output).toContain("wiki close-prd <project> <PRD-ID> [--force] [--yes-really-force]");
    expect(output).toContain("wiki close-slice <project> <slice-id> [--repo <path>] [--base <rev>] [--worktree] [--force] [--yes-really-force] [--json]");
    expect(output).toContain("wiki refresh-on-merge <project> [--repo <path>] [--base <rev>] [--json] [--verbose]");
    expect(output).toContain("wiki ask <project> [--expand] [--verbose] [-n <num>] <question...>");
    expect(output).toContain("wiki file-answer <project> [--expand] [--verbose] [--slug <slug>] [-n <num>] <question...>");
    expect(output).toContain("wiki qmd-setup");
    expect(output).toContain("wiki qmd-status");
    expect(output).toContain("wiki gate <project> [--repo <path>] [--base <rev>] [--worktree] [--structural-refactor] [--json]");
    expect(output).toContain("wiki start-slice <project> <slice-id> [--agent <name>] [--repo <path>] [--json]");
    expect(output).toContain("wiki export-prompt <project> <slice-id> [--agent codex|claude|pi]");
    expect(output).toContain("wiki resume <project> [--repo <path>] [--base <rev>] [--json]");
    expect(output).toContain("wiki dependency-graph <project> [--write] [--json]");
    expect(output).toContain("wiki research file <topic>");
    expect(output).toContain("wiki research distill <research-page>");
    expect(output).toContain("wiki source ingest");
    expect(output).toContain("Agent Surface");
    expect(output).toContain("wiki forge plan");
    expect(output).toContain("wiki forge run");
    expect(output).toContain("wiki forge next");
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
    expect(output).toContain("File high-signal findings into the vault with `wiki research file demo <title>`");
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

  test("dashboard renders project status as JSON", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["dashboard", "demo", "--repo", repo, "--base", "HEAD"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.project).toBe("demo");
    expect(json).toHaveProperty("drift");
    expect(json).toHaveProperty("status");
  });
});
