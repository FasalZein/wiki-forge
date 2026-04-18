import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setRepoFrontmatter, setupVaultAndRepo, tempDir, runGit } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("gate diagnostics", () => {
  test("keeps project debt visible as project-scoped warnings", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "ad-hoc.md"), "# nope\n", "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "project" && finding.severity === "warning" && finding.message.includes("repo markdown doc"))).toBe(true);
  });

  test("surfaces parent-scoped R4 escalation warning for ambiguous lifecycle drift", () => {
    const { vault, repo } = setupVaultAndRepo();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-feature", "demo", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-prd", "demo", "--feature", "FEAT-001", "Alpha"], env).exitCode).toBe(0);
    expect(runWiki(["create-issue-slice", "demo", "alpha slice", "--prd", "PRD-001"], env).exitCode).toBe(0);

    const featurePath = join(vault, "projects", "demo", "specs", "features", "FEAT-001-alpha.md");
    const prdPath = join(vault, "projects", "demo", "specs", "prds", "PRD-001-alpha.md");
    const slicePath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");

    writeFileSync(featurePath, readFileSync(featurePath, "utf8").replace("status: draft", "status: complete"), "utf8");
    writeFileSync(prdPath, readFileSync(prdPath, "utf8").replace("status: draft", "status: complete"), "utf8");
    // Slice is done but only code-verified — not cancelled/non-terminal, so no deterministic R2/R3 applies.
    // Falls through to R4: parent drift is escalated with inverse commands (not auto-healed).
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("status: draft", "status: done\nverification_level: code-verified"), "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--worktree", "--json"], env);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.toString());
    // R4 escalation: parent-scoped warning with inverse commands (wiki lifecycle open/close)
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) =>
      finding.scope === "parent" && finding.severity === "warning" && finding.message.includes("wiki lifecycle")
    )).toBe(true);
  });
});

describe("gate typecheck", () => {
  function setupRepoWithTypecheck(passingCheck: boolean) {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo");
    mkdirSync(join(repo, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(vault, "projects"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 1\n", "utf8");
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "tests", "auth.test.ts"), "import { test, expect } from 'bun:test'\ntest('auth', () => expect(1).toBe(1))\n", "utf8");
    const checkScript = passingCheck ? "exit 0" : "exit 1";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { check: checkScript } }, null, 2), "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    writeFileSync(join(repo, "src", "auth.ts"), "export const a = 2\n", "utf8");
    writeFileSync(join(repo, "tests", "auth.test.ts"), "import { test, expect } from 'bun:test'\ntest('auth changed', () => expect(2 - 1).toBe(1))\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    return { vault, repo };
  }

  test("adds blocker when typecheck fails", () => {
    const { vault, repo } = setupRepoWithTypecheck(false);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.some((finding: { scope: string; severity: string; message: string }) => finding.scope === "slice" && finding.severity === "blocker" && finding.message === "typecheck failed")).toBe(true);
    expect(json.ok).toBe(false);
  });

  test("passes when typecheck succeeds", () => {
    const { vault, repo } = setupRepoWithTypecheck(true);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    expect(json.findings.every((finding: { scope: string; severity: string; message: string }) => !(finding.severity === "blocker" && finding.message === "typecheck failed"))).toBe(true);
  });
});

describe("gate test_exemptions", () => {
  function setupExemptionRepo(files: Array<{ path: string; v1: string; v2: string }>) {
    const vault = tempDir("wiki-vault");
    const repo = tempDir("wiki-repo-exempt");
    mkdirSync(join(vault, "projects"), { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
    mkdirSync(join(repo, "tests"), { recursive: true });
    for (const f of files) {
      mkdirSync(join(repo, f.path.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(join(repo, f.path), f.v1, "utf8");
    }
    writeFileSync(join(repo, "tests", "unrelated.test.ts"), "import { test, expect } from 'bun:test'\ntest('unrelated', () => expect(1).toBe(1))\n", "utf8");
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);
    for (const f of files) writeFileSync(join(repo, f.path), f.v2, "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "second"]);
    return { vault, repo };
  }

  test("exact-path exemption removes file from blockers while non-exempted file remains", () => {
    const { vault, repo } = setupExemptionRepo([
      { path: "src/types.ts", v1: "export type Foo = string;\n", v2: "export type Foo = number;\n" },
      { path: "src/payments.ts", v1: "export const total = 1\n", v2: "export const total = 2\n" },
    ]);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "payments slice"], env).exitCode).toBe(0);

    const slicePath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("source_paths: []", "source_paths:\n  - src/types.ts\n  - src/payments.ts\ntest_exemptions:\n  - src/types.ts"), "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--slice-local", "--slice-id", "DEMO-001", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    const missingTestsBlockers = json.findings.filter((f: { severity: string; scope: string; message: string }) => f.severity === "blocker" && f.scope === "slice" && f.message.includes("changed code file"));
    expect(missingTestsBlockers.length).toBe(1);
    expect(missingTestsBlockers[0].message).toBe("1 changed code file(s) have no matching changed tests");
  });

  test("glob pattern exemption (*.d.ts) removes matching files from blockers", () => {
    const { vault, repo } = setupExemptionRepo([
      { path: "src/api.d.ts", v1: "export declare const x: string;\n", v2: "export declare const x: number;\n" },
      { path: "src/payments.ts", v1: "export const total = 1\n", v2: "export const total = 2\n" },
    ]);
    const env = { KNOWLEDGE_VAULT_ROOT: vault };
    expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
    setRepoFrontmatter(vault, repo);
    expect(runWiki(["create-issue-slice", "demo", "api slice"], env).exitCode).toBe(0);

    const slicePath = join(vault, "projects", "demo", "specs", "slices", "DEMO-001", "index.md");
    writeFileSync(slicePath, readFileSync(slicePath, "utf8").replace("source_paths: []", "source_paths:\n  - src/api.d.ts\n  - src/payments.ts\ntest_exemptions:\n  - '*.d.ts'"), "utf8");

    const result = runWiki(["gate", "demo", "--repo", repo, "--base", "HEAD~1", "--slice-local", "--slice-id", "DEMO-001", "--json"], env);
    const json = JSON.parse(result.stdout.toString());
    const missingTestsBlockers = json.findings.filter((f: { severity: string; scope: string; message: string }) => f.severity === "blocker" && f.scope === "slice" && f.message.includes("changed code file"));
    expect(missingTestsBlockers.length).toBe(1);
    expect(missingTestsBlockers[0].message).toBe("1 changed code file(s) have no matching changed tests");
  });
});
