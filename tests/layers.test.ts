import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function setupVault() {
  const vault = tempDir("wiki-vault-layers");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(join(vault, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(vault, "index.md"), "# Index\n", "utf8");
  return vault;
}

describe("scaffold-layer", () => {
  test("creates books layer index file", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["scaffold-layer", "books"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "index.md"))).toBe(true);
    const content = readFileSync(join(vault, "books", "index.md"), "utf8");
    expect(content).toContain("type: layer-index");
    expect(content).toContain("layer: books");
  });

  test("is idempotent — does not overwrite existing layer index", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    writeFileSync(join(vault, "books", "index.md"), "# My Custom Index\n", "utf8");

    const result = runWiki(["scaffold-layer", "books"], env);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(vault, "books", "index.md"), "utf8")).toBe("# My Custom Index\n");
  });

  test("rejects unknown layer name", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["scaffold-layer", "nonexistent-layer"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown layer");
  });
});

describe("create-layer-page", () => {
  test("creates a new page in the books layer", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    const result = runWiki(["create-layer-page", "books", "The Pragmatic Programmer"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(vault, "books", "the-pragmatic-programmer.md"))).toBe(true);
    const content = readFileSync(join(vault, "books", "the-pragmatic-programmer.md"), "utf8");
    expect(content).toContain("type: layer-page");
    expect(content).toContain("layer: books");
    expect(content).toContain("The Pragmatic Programmer");
  });

  test("fails if layer page already exists", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    runWiki(["scaffold-layer", "books"], env);
    runWiki(["create-layer-page", "books", "Duplicate Book"], env);
    const result = runWiki(["create-layer-page", "books", "Duplicate Book"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("layer page already exists");
  });

  test("rejects unknown layer", () => {
    const vault = setupVault();
    const env = { KNOWLEDGE_VAULT_ROOT: vault };

    const result = runWiki(["create-layer-page", "unknown-layer", "Some Title"], env);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown layer");
  });
});

describe("skill layer separation", () => {
  test("wiki skill does not reintroduce SDLC command catalogs or closeout policy", () => {
    const wikiSkill = readFileSync(join(process.cwd(), "skills", "wiki", "SKILL.md"), "utf8");
    expect(wikiSkill).not.toContain("## Canonical Code-Driven Closeout Sequence");
    expect(wikiSkill).not.toContain("## Definition of Done");
    expect(wikiSkill).not.toContain("## Greenfield Project");
    expect(wikiSkill).not.toContain("computed_status");
    expect(wikiSkill).not.toContain("create-feature`, `create-prd`, `create-issue-slice`, `start-slice`");
    expect(wikiSkill).not.toContain("start-feature`, `close-feature`, `start-prd`, `close-prd`");
    expect(wikiSkill).toContain("1. `wiki checkpoint` = current freshness truth");
    expect(wikiSkill).toContain("2. `wiki maintain` = repair and reconciliation guidance");
    expect(wikiSkill).toContain("3. `wiki resume` = convenience context only; may include historical or stale-looking notes");
    expect(wikiSkill).toContain("## Router");
    expect(wikiSkill).toContain("## Main Commands");
    expect(wikiSkill.indexOf("## Router")).toBeLessThan(wikiSkill.indexOf("## Main Commands"));
    expect(wikiSkill).toContain("## Generated and Derived Pages");
    expect(wikiSkill).toContain("`wiki refresh-from-git <project> --repo <path> --base <rev>`");
    expect(wikiSkill).toContain("`wiki acknowledge-impact <project> <page...> --repo <path>`");
    expect(wikiSkill).toContain("`wiki bind <project> <page> <source-path...>`");
    expect(wikiSkill).toContain("## Freshness Repair Path");
    expect(wikiSkill).toContain("`wiki research adopt <research-page> --project <project> --slice <slice-id>`");
    expect(wikiSkill).toContain("Distill updates project truth. Adopt bridges accepted findings into forge-visible slice workflow.");
    expect(wikiSkill).toContain("run `bun run sync:local`, then `bun run sync:local -- --audit`, then restart the agent session");
  });

  test("domain-model skill and templates stay wiki-native for forge-managed projects", () => {
    const domainModelSkill = readFileSync(join(process.cwd(), "skills", "domain-model", "SKILL.md"), "utf8");
    const adrFormat = readFileSync(join(process.cwd(), "skills", "domain-model", "ADR-FORMAT.md"), "utf8");
    const contextFormat = readFileSync(join(process.cwd(), "skills", "domain-model", "CONTEXT-FORMAT.md"), "utf8");
    const writePrdSkill = readFileSync(join(process.cwd(), "skills", "write-a-prd", "SKILL.md"), "utf8");
    const forgeSkill = readFileSync(join(process.cwd(), "skills", "forge", "SKILL.md"), "utf8");
    const grillSkill = readFileSync(join(process.cwd(), "skills", "grill-me", "SKILL.md"), "utf8");
    const agents = readFileSync(join(process.cwd(), "AGENTS.md"), "utf8");
    const agentsLocal = agents.split("# AGENTS")[1] ?? "";

    expect(domainModelSkill).toContain("## Pre-PRD Outputs");
    expect(domainModelSkill).toContain("projects/<project>/decisions.md");
    expect(domainModelSkill).toContain("projects/<project>/architecture/domain-language.md");
    expect(domainModelSkill).toContain("`write-a-prd` should consume");
    expect(domainModelSkill).not.toContain("### Update CONTEXT.md inline");

    expect(adrFormat).toContain("projects/<project>/decisions.md");
    expect(adrFormat.indexOf("projects/<project>/decisions.md")).toBeLessThan(adrFormat.indexOf("docs/adr/"));
    expect(contextFormat).toContain("projects/<project>/architecture/domain-language.md");
    expect(contextFormat).toContain("content shape");

    expect(writePrdSkill).toContain("projects/<project>/decisions.md");
    expect(writePrdSkill).toContain("projects/<project>/architecture/domain-language.md");
    expect(writePrdSkill).not.toContain("research and grilling");

    expect(forgeSkill).toContain("research -> domain-model -> PRD");
    expect(forgeSkill).not.toContain("companion skills");
    expect(forgeSkill).toContain("## Router");
    expect(forgeSkill).toContain("## State Table");
    expect(forgeSkill).toContain("## Repair Branches");
    expect(forgeSkill.indexOf("## Router")).toBeLessThan(forgeSkill.indexOf("## Default Surface"));
    expect(forgeSkill).toContain("Use this precedence:");
    expect(forgeSkill).toContain("1. `wiki checkpoint` = current freshness truth");
    expect(forgeSkill).toContain("2. `wiki maintain` = repair/reconciliation plan");
    expect(forgeSkill).toContain("3. `wiki forge status` = workflow ledger truth");
    expect(forgeSkill).toContain("4. `wiki resume` = operator context summary only");
    expect(forgeSkill).toContain("Do not improvise lower-level lifecycle commands during normal execution.");
    expect(forgeSkill).toContain("When debugging, prefer the slice-scoped form.");
    expect(forgeSkill).toContain("`wiki acknowledge-impact <project> <page...> --repo <path>`");
    expect(forgeSkill).toContain("`wiki refresh-from-git <project> --repo <path> --base <rev>`");
    expect(forgeSkill).toContain("`wiki bind <project> <page> <source-path...> [--mode replace|merge]`");
    expect(forgeSkill).toContain("wiki research adopt <research-page> --project <project> --slice <slice-id>");
    expect(forgeSkill).toContain("rerun verify-slice");
    expect(forgeSkill).toContain("--slice-local --slice-id <slice>");
    expect(forgeSkill).toContain("--force-review");

    expect(grillSkill).toContain("Compatibility note");
    expect(grillSkill).toContain("Use `/domain-model` as the primary path");
    expect(grillSkill).not.toContain("Always grill before writing the PRD");

    expect(domainModelSkill).toContain("## Forge Ledger Expectations");
    expect(domainModelSkill).toContain("domain-model.completedAt");
    expect(domainModelSkill).toContain("domain-model.decisionRefs");

    expect(agents).toContain("Bootstrap only:");
    expect(agents).not.toContain("Decision rule:");
    expect(agentsLocal).not.toContain("wiki forge plan|run|next");
  });
});
