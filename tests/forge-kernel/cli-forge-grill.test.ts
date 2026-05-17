import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectGrillWithDocsRefs } from "../../src/forge/status";
import { cleanupTempPaths, initVault, runWiki, tempDir } from "../test-helpers";

afterEach(() => cleanupTempPaths());

describe("Forge grill-with-docs artifact recording", () => {
  test("records context and numbered ADR-style decisions in wiki-native files", async () => {
    const vault = tempDir("wiki-forge-grill-vault");
    initVault(vault);
    const inputDir = join(vault, "inputs");
    mkdirSync(inputDir, { recursive: true });
    const contextFile = join(inputDir, "domain-language.md");
    const decisionFile = join(inputDir, "decision.md");
    writeFileSync(contextFile, "# Domain Language\n\n## Language\n\n**Metric**:\nA displayed financial value.\n", "utf8");
    writeFileSync(decisionFile, "Server data layer owns financial metric calculations.", "utf8");

    const result = runWiki([
      "forge",
      "grill",
      "record",
      "demo",
      "--context-file",
      contextFile,
      "--decision-title",
      "Server owns financial metrics",
      "--decision-file",
      decisionFile,
      "--tag",
      "PRD-001",
      "--tag",
      "DEMO-001",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      status: "recorded",
      project: "demo",
      contextPath: "projects/demo/architecture/domain-language.md",
      decisionRefs: ["projects/demo/adrs/ADR-0001-server-owns-financial-metrics.md"],
    });

    const contextPath = join(vault, "projects", "demo", "architecture", "domain-language.md");
    expect(existsSync(contextPath)).toBe(true);
    expect(readFileSync(contextPath, "utf8")).toContain("**Metric**");

    const adr = readFileSync(join(vault, "projects", "demo", "adrs", "ADR-0001-server-owns-financial-metrics.md"), "utf8");
    expect(adr).toContain("# ADR-0001 — Server owns financial metrics");
    expect(adr).toContain("- Status: accepted");
    expect(adr).toContain("- Related: PRD-001, DEMO-001");
    expect(adr).toContain("- Decision: Server data layer owns financial metric calculations.");

    const decisions = readFileSync(join(vault, "projects", "demo", "decisions.md"), "utf8");
    expect(decisions).toContain("- [[projects/demo/adrs/ADR-0001-server-owns-financial-metrics|ADR-0001 — Server owns financial metrics]] [PRD-001] [DEMO-001]");

    const detected = await detectGrillWithDocsRefs("demo", "DEMO-001", "PRD-001", undefined, vault);
    expect(detected.decisionRefs).toEqual(["projects/demo/adrs/ADR-0001-server-owns-financial-metrics.md"]);
  });

  test("records named context pages and maintains a context map", () => {
    const vault = tempDir("wiki-forge-grill-context-map-vault");
    initVault(vault);
    const inputDir = join(vault, "inputs");
    mkdirSync(inputDir, { recursive: true });
    const contextFile = join(inputDir, "billing.md");
    writeFileSync(contextFile, "# Billing Context\n\n## Language\n\n**Invoice**:\nA request for payment.\n", "utf8");

    const result = runWiki([
      "forge",
      "grill",
      "record",
      "demo",
      "--context-file",
      contextFile,
      "--context",
      "Billing",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      contextPath: "projects/demo/architecture/contexts/billing.md",
    });

    const contextPath = join(vault, "projects", "demo", "architecture", "contexts", "billing.md");
    expect(readFileSync(contextPath, "utf8")).toContain("**Invoice**");

    const contextMap = readFileSync(join(vault, "projects", "demo", "architecture", "context-map.md"), "utf8");
    expect(contextMap).toContain("# Context Map");
    expect(contextMap).toContain("- [[projects/demo/architecture/contexts/billing|Billing]]");
  });

  test("increments ADR numbers from existing decision log", () => {
    const vault = tempDir("wiki-forge-grill-increment-vault");
    initVault(vault);
    const projectDir = join(vault, "projects", "demo");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "decisions.md"), "# Decisions\n\n### ADR-0007 — Existing choice\n\n- Decision: Existing.\n", "utf8");

    const result = runWiki([
      "forge",
      "grill",
      "record",
      "demo",
      "--decision-title",
      "Next choice",
      "--decision",
      "Choose the next thing.",
      "--json",
    ], { vault });

    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ decisionRefs: ["projects/demo/adrs/ADR-0008-next-choice.md"] });
    expect(readFileSync(join(projectDir, "decisions.md"), "utf8")).toContain("- [[projects/demo/adrs/ADR-0008-next-choice|ADR-0008 — Next choice]]");
    expect(readFileSync(join(projectDir, "adrs", "ADR-0008-next-choice.md"), "utf8")).toContain("# ADR-0008 — Next choice");
  });
});
