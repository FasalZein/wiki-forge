import { describe, expect, test } from "bun:test";
import { classifyVaultFolderPath, describeVaultFolderTaxonomy, isAllowedCanonicalVaultPath, isGeneratedVaultProjectionPath } from "../src/shared/project-structure/vault-taxonomy";

describe("vault folder taxonomy", () => {
  test("classifies canonical project, research, cross-project, and generated paths", () => {
    expect(classifyVaultFolderPath("projects/wiki-forge/_summary.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
      writableByDefault: true,
      lifecycleAuthority: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/context.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
      writableByDefault: true,
      lifecycleAuthority: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/modules/retrieval/spec.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/contracts/state-contract.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/bugs/BUG-0001-cli-crash.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
      writableByDefault: true,
      lifecycleAuthority: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/forge/slices/WIKI-FORGE-246/index.md")).toMatchObject({
      kind: "canonical-project-knowledge",
      project: "wiki-forge",
      canonical: true,
      lifecycleAuthority: true,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/research/auth/session-options.md")).toMatchObject({
      kind: "project-bound-research",
      project: "wiki-forge",
      canonical: true,
      writableByDefault: true,
    });
    expect(classifyVaultFolderPath("research/agent-workflows/qmd-indexing.md")).toMatchObject({
      kind: "cross-project-research",
      canonical: true,
      writableByDefault: true,
    });
    for (const path of ["index.md", "projects/_dashboard.md", "projects/wiki-forge/status.md", "projects/wiki-forge/backlog.md", "projects/wiki-forge/specs/index.md"]) {
      expect(classifyVaultFolderPath(path)).toMatchObject({
        kind: "generated-projection",
        canonical: false,
        writableByDefault: false,
        lifecycleAuthority: false,
      });
      expect(isGeneratedVaultProjectionPath(path)).toBe(true);
    }
  });

  test("normalizes paths and distinguishes archive, quarantine, and disallowed shapes", () => {
    expect(classifyVaultFolderPath("./projects\\wiki-forge\\research\\auth\\_overview.md")).toMatchObject({
      kind: "project-bound-research",
      path: "projects/wiki-forge/research/auth/_overview.md",
      project: "wiki-forge",
    });
    expect(classifyVaultFolderPath("research/projects/wiki-forge/auth.md")).toMatchObject({
      kind: "ghost-or-quarantine-candidate",
      canonical: false,
      writableByDefault: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/specs/slices/WIKI-FORGE-001/index.md")).toMatchObject({
      kind: "ghost-or-quarantine-candidate",
      canonical: false,
      writableByDefault: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/legacy/source-inventory.md")).toMatchObject({
      kind: "archived-or-legacy",
      project: "wiki-forge",
      writableByDefault: false,
    });
    expect(classifyVaultFolderPath("legacy/old-note.md")).toMatchObject({
      kind: "archived-or-legacy",
      writableByDefault: false,
    });
    expect(classifyVaultFolderPath("projects/wiki-forge/random/note.md")).toMatchObject({
      kind: "ghost-or-quarantine-candidate",
      project: "wiki-forge",
    });
    expect(classifyVaultFolderPath("../outside.md")).toMatchObject({
      kind: "disallowed",
      canonical: false,
      writableByDefault: false,
    });
    expect(classifyVaultFolderPath("notes.md")).toMatchObject({
      kind: "disallowed",
      canonical: false,
      writableByDefault: false,
    });
  });

  test("supports absolute vault paths without reading the filesystem", () => {
    expect(classifyVaultFolderPath("/Users/tothemoon/Knowledge/projects/wiki-forge/research/auth/session-options.md", { vaultRoot: "/Users/tothemoon/Knowledge" })).toMatchObject({
      kind: "project-bound-research",
      path: "projects/wiki-forge/research/auth/session-options.md",
      project: "wiki-forge",
    });
    expect(classifyVaultFolderPath("/tmp/outside.md", { vaultRoot: "/Users/tothemoon/Knowledge" })).toMatchObject({
      kind: "disallowed",
      reason: expect.stringContaining("outside vault root"),
    });
  });

  test("exposes allowed canonical and human-readable taxonomy summaries", () => {
    expect(isAllowedCanonicalVaultPath("projects/wiki-forge/research/auth/session-options.md")).toBe(true);
    expect(isAllowedCanonicalVaultPath("projects/wiki-forge/backlog.md")).toBe(false);
    expect(isAllowedCanonicalVaultPath("research/projects/wiki-forge/auth.md")).toBe(false);

    const summary = describeVaultFolderTaxonomy().join("\n");
    for (const kind of [
      "canonical-project-knowledge",
      "project-bound-research",
      "cross-project-research",
      "generated-projection",
      "archived-or-legacy",
      "ghost-or-quarantine-candidate",
      "disallowed",
    ]) {
      expect(summary).toContain(kind);
    }
    expect(summary).toContain("projects/<project>/context.md");
    expect(summary).toContain("bugs/BUG-NNNN-slug.md");
    expect(summary).toContain("projects/<project>/research/<topic>/<slug>.md");
    expect(summary).toContain("research/<topic>/<slug>.md");
  });
});
