import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("wiki config init/validate/explain", () => {
  test("defaults to a canonical ~/Knowledge vault and creates the minimal shape", () => {
    const home = tempDir("wiki-canonical-home");
    const result = runWiki(["help"], { HOME: home, KNOWLEDGE_VAULT_ROOT: "" });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, "Knowledge", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(home, "Knowledge", "index.md"))).toBe(true);
    expect(existsSync(join(home, "Knowledge", "projects"))).toBe(true);
  });

  test("missing explicit vault override fails loudly instead of creating a sibling folder", () => {
    const home = tempDir("wiki-missing-vault-home");
    const missing = join(home, "MissingKnowledge");
    const result = runWiki(["help"], { HOME: home, KNOWLEDGE_VAULT_ROOT: missing });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("KNOWLEDGE_VAULT_ROOT points to non-existent path");
    expect(result.stderr.toString()).toContain("Recovery: create the directory first");
    expect(result.stderr.toString()).toContain("unset KNOWLEDGE_VAULT_ROOT to use the canonical ~/Knowledge vault");
  });

  test("detects an existing parent vault before falling back to ~/Knowledge", () => {
    const home = tempDir("wiki-parent-vault-home");
    const repo = join(home, "workspace", "app");
    const vault = join(home, "workspace");
    mkdirSync(join(vault, "projects"), { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");

    const result = runWiki(["help"], { cwd: repo, env: { HOME: home, KNOWLEDGE_VAULT_ROOT: "" } });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, "Knowledge"))).toBe(false);
  });

  test("init orients a project without creating repo-local wiki folders", () => {
    const home = tempDir("wiki-init-home");
    const repo = join(home, "repo");
    const vault = join(home, "Knowledge");
    mkdirSync(repo, { recursive: true });
    mkdirSync(vault, { recursive: true });

    const result = runWiki(["init", "demo", "--repo", repo], { HOME: home, KNOWLEDGE_VAULT_ROOT: vault });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("wiki init: demo");
    expect(output).toContain(`Repo root: ${repo}`);
    expect(output).toContain(`Knowledge vault root: ${vault}`);
    expect(output).toContain(`Project wiki root: ${join(vault, "projects", "demo")}`);
    expect(output).toContain("Do not create repo-local `projects/`, `wiki/`, or `forge/` folders");
    expect(output).toContain("wiki resume demo --repo");
    expect(existsSync(join(repo, "projects"))).toBe(false);
    expect(existsSync(join(repo, "wiki"))).toBe(false);
    expect(existsSync(join(repo, "forge"))).toBe(false);
    expect(existsSync(join(repo, "wiki.config.jsonc"))).toBe(true);

    const effective = runWiki(["config", "--effective", "--repo", repo], { HOME: home, KNOWLEDGE_VAULT_ROOT: "" });
    expect(effective.exitCode).toBe(0);
    expect(effective.stdout.toString()).toContain(`vault.root = ${JSON.stringify(vault)}`);
  });

  test("config init writes a discoverable project config", () => {
    const repo = tempDir("wiki-config-init");
    const result = runWiki(["config", "init", "--repo", repo], { HOME: repo });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(repo, "wiki.config.jsonc"))).toBe(true);
  });

  test("validate accepts a config that only adds repo ignores", () => {
    const repo = tempDir("wiki-config-validate");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": ["docs/generated/**"] } }`, "utf8");
    const result = runWiki(["config", "validate", "--repo", repo, "--json"], { HOME: repo });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString()).ok).toBe(true);
  });

  test("explain reports the effective value and source for a leaf", () => {
    const repo = tempDir("wiki-config-explain");
    writeFileSync(join(repo, "wiki.config.jsonc"), `{ "repo": { "ignore": ["docs/generated/**"] } }`, "utf8");
    const result = runWiki(["config", "explain", "repo.ignore", "--repo", repo, "--json"], { HOME: repo });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.source).toBe("project");
    expect(parsed.value).toContain("node_modules/**");
    expect(parsed.value).toContain("docs/generated/**");
  });
});
