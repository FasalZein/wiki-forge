import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runGit, runWiki, setRepoFrontmatter, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupCascadeFixture() {
  const vault = tempDir("wf145-cascade-vault");
  const repo = tempDir("wf145-cascade-repo");
  initVault(vault);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), "export const auth = 1\n", "utf8");
  writeFileSync(join(repo, "src", "billing.ts"), "export const billing = 1\n", "utf8");
  writeFileSync(join(repo, "src", "payments.ts"), "export const payments = 1\n", "utf8");
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init"]);

  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", "wf145c"], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, "wf145c");
  expect(runWiki(["create-module", "wf145c", "auth", "--source", "src/auth.ts"], env).exitCode).toBe(0);
  expect(runWiki(["create-module", "wf145c", "billing", "--source", "src/billing.ts"], env).exitCode).toBe(0);
  expect(runWiki(["create-module", "wf145c", "payments", "--source", "src/payments.ts"], env).exitCode).toBe(0);
  expect(
    runWiki(
      [
        "acknowledge-impact",
        "wf145c",
        "modules/auth/spec.md",
        "modules/billing/spec.md",
        "modules/payments/spec.md",
        "--repo",
        repo,
      ],
      env,
    ).exitCode,
  ).toBe(0);

  const pages = [
    join(vault, "projects", "wf145c", "modules", "auth", "spec.md"),
    join(vault, "projects", "wf145c", "modules", "billing", "spec.md"),
    join(vault, "projects", "wf145c", "modules", "payments", "spec.md"),
  ];
  return { vault, repo, env, pages };
}

function backdateUpdatedField(filePath: string, iso = "2010-01-01T00:00:00.000Z") {
  const raw = readFileSync(filePath, "utf8");
  writeFileSync(filePath, raw.replace(/^updated:\s+.*$/mu, `updated: '${iso}'`), "utf8");
}

function readUpdatedField(filePath: string) {
  return readFileSync(filePath, "utf8").match(/^updated:\s*['"]?([^'"\n]+)/mu)?.[1] ?? null;
}

function addProjectDebtNotes(vault: string) {
  const reviewsDir = join(vault, "projects", "wf145c", "architecture", "reviews");
  mkdirSync(reviewsDir, { recursive: true });
  writeFileSync(
    join(reviewsDir, "resume-noise-audit.md"),
    "---\ntitle: Resume Noise Audit\ntype: notes\nproject: wf145c\nupdated: 2026-04-20\nstatus: current\nverification_level: inferred\n---\n\n# Resume Noise Audit\n",
    "utf8",
  );
  writeFileSync(
    join(reviewsDir, "resume-noise-follow-up.md"),
    "---\ntitle: Resume Noise Follow Up\ntype: notes\nproject: wf145c\nupdated: 2026-04-20\nstatus: current\nverification_level: inferred\n---\n\n# Resume Noise Follow Up\n",
    "utf8",
  );
}

describe("WIKI-FORGE-145 clean-repo cascade refresh", () => {
  test("checkpoint --base HEAD ignores mtime-only stale pages on a clean committed repo", () => {
    const { repo, env, pages } = setupCascadeFixture();
    for (const page of pages) backdateUpdatedField(page);

    const result = runWiki(["checkpoint", "wf145c", "--repo", repo, "--base", "HEAD", "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.base).toBe("HEAD");
    expect(payload.modifiedFiles).toBe(0);
    expect(payload.clean).toBe(true);
    expect(payload.stalePages).toEqual([]);
  });

  test("resume --base HEAD does not surface stale context when checkpoint is clean", () => {
    const { repo, env, pages } = setupCascadeFixture();
    for (const page of pages) backdateUpdatedField(page);

    const result = runWiki(["resume", "wf145c", "--repo", repo, "--base", "HEAD", "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.stalePages).toEqual([]);
  });

  test("resume collapses background bind-page debt instead of printing raw action spam", () => {
    const { vault, repo, env, pages } = setupCascadeFixture();
    for (const page of pages) backdateUpdatedField(page);
    addProjectDebtNotes(vault);

    const result = runWiki(["resume", "wf145c", "--repo", repo, "--base", "HEAD"], env);

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("background debt (not blocking):");
    expect(output).toContain("[project][bind-page]");
    expect(output).toContain("items (first:");
    expect(output).not.toContain("resume-noise-audit.md has no source_paths\n- [project][bind-page] resume-noise-follow-up.md has no source_paths");
  });

  test("refresh-from-git --base HEAD stamps acknowledged pages whose only drift is mtime/update skew", () => {
    const { vault, repo, env, pages } = setupCascadeFixture();
    for (const page of pages) backdateUpdatedField(page);

    const result = runWiki(["refresh-from-git", "wf145c", "--repo", repo, "--base", "HEAD", "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.changedFiles).toEqual([]);

    for (const page of pages) {
      expect(readUpdatedField(page)).not.toBe("2010-01-01T00:00:00.000Z");
    }

    const logPath = join(vault, "log.md");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf8");
    expect((log.match(/auto-heal \| cascade-refresh/g) ?? []).length).toBe(3);
    expect(log).toContain("reason=mtime-drift");
    expect(log).toContain("page=modules/auth/spec.md");
    expect(log).toContain("page=modules/billing/spec.md");
    expect(log).toContain("page=modules/payments/spec.md");
  });

  test("refresh-from-git --base HEAD is a no-op when page timestamps are already current", () => {
    const { vault, repo, env, pages } = setupCascadeFixture();
    const before = pages.map((page) => readFileSync(page, "utf8"));

    const result = runWiki(["refresh-from-git", "wf145c", "--repo", repo, "--base", "HEAD", "--json"], env);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout.toString());
    expect(payload.changedFiles).toEqual([]);
    expect(payload.impactedPages).toEqual([]);

    const after = pages.map((page) => readFileSync(page, "utf8"));
    expect(after).toEqual(before);

    const logPath = join(vault, "log.md");
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    expect(log).not.toContain("auto-heal | cascade-refresh");
  });
});
