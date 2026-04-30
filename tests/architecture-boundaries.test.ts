import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

type SourceBoundary = "wiki" | "forge" | "shared" | "lib";

type RelativeImportEdge = {
  readonly importer: string;
  readonly importee: string;
  readonly specifier: string;
  readonly from: SourceBoundary;
  readonly to: SourceBoundary;
};

type BoundaryException = {
  readonly importer: string;
  readonly importee: string;
  readonly reason: string;
};

const SOURCE_BOUNDARIES: readonly SourceBoundary[] = ["wiki", "forge", "shared", "lib"];

const TRANSITION_EXCEPTIONS = {
  forgeImportsWikiInternals: [
    {
      importer: "src/forge/status/index.ts",
      importee: "src/wiki/project-views/index.ts",
      reason: "Forge status still reads Wiki project-view context until project-view status contracts move behind a shared read model.",
    },
  ],
  wikiImportsForgeInternals: [
    {
      importer: "src/wiki/index.ts",
      importee: "src/forge/workflow/commands.ts",
      reason: "The Wiki router directly imports Forge workflow commands until the public command seam is split.",
    },
    {
      importer: "src/wiki/memory/handover/store.ts",
      importee: "src/forge/vault/forge-paths.ts",
      reason: "Wiki handover storage still writes Forge vault paths until handover storage contracts move to src/shared.",
    },
    {
      importer: "src/wiki/memory/handover/store.ts",
      importee: "src/forge/vault/frontmatter-codec.ts",
      reason: "Wiki handover storage still uses Forge frontmatter codecs until handover storage contracts move to src/shared.",
    },
    {
      importer: "src/wiki/memory/handover/store.ts",
      importee: "src/forge/vault/records.ts",
      reason: "Wiki handover storage still decodes Forge records until the handover record contract moves to src/shared.",
    },
    {
      importer: "src/wiki/memory/projections/amend.ts",
      importee: "src/forge/lifecycle/evidence.ts",
      reason: "Wiki amend projection still reads Forge lifecycle evidence until projection contracts move behind a shared read model.",
    },
    {
      importer: "src/wiki/memory/projections/amend.ts",
      importee: "src/forge/lifecycle/forge-close-intent.ts",
      reason: "Wiki amend projection still references Forge close intent until projection contracts move behind a shared read model.",
    },
    {
      importer: "src/wiki/memory/projections/resume.ts",
      importee: "src/forge/workflow/status-projection.ts",
      reason: "Wiki resume projection still renders Forge status until status projection contracts move behind a shared read model.",
    },
    {
      importer: "src/wiki/research/adopt.ts",
      importee: "src/forge/status/index.ts",
      reason: "Wiki research adoption still reads Forge status until research handoff uses a shared status read model.",
    },
    {
      importer: "src/wiki/memory/prompt-packet.ts",
      importee: "src/forge/workflow/status-projection.ts",
      reason: "Wiki prompt packets still render Forge status until status projection contracts move behind a shared read model.",
    },
    {
      importer: "src/wiki/memory/session-commands.ts",
      importee: "src/forge/vault/load-project.ts",
      reason: "Wiki session commands still load Forge project records until command seams and shared project state contracts split.",
    },
  ],
} satisfies Record<string, readonly BoundaryException[]>;

const importSpecifierPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

describe("source architecture boundaries", () => {
  test("src/shared does not import Wiki or Forge domain code", () => {
    expect(importsFrom("shared", ["wiki", "forge"])).toEqual([]);
  });

  test("src/lib does not import Wiki or Forge domain code", () => {
    expect(importsFrom("lib", ["wiki", "forge"])).toEqual([]);
  });

  test("src/forge does not import Wiki internals except documented transition seams", () => {
    expect(withoutExceptions(importsFrom("forge", ["wiki"]), TRANSITION_EXCEPTIONS.forgeImportsWikiInternals)).toEqual([]);
  });

  test("src/wiki does not import Forge internals except documented transition seams", () => {
    expect(withoutExceptions(importsFrom("wiki", ["forge"]), TRANSITION_EXCEPTIONS.wikiImportsForgeInternals)).toEqual([]);
  });

  test("transition exceptions stay exact and justified", () => {
    const edges = relativeImportEdges();

    for (const exception of Object.values(TRANSITION_EXCEPTIONS).flat()) {
      expect(exception.reason.length).toBeGreaterThan(20);
      expect(edges).toContainEqual(expect.objectContaining({ importer: exception.importer, importee: exception.importee }));
    }
  });
});

function importsFrom(from: SourceBoundary, forbiddenTargets: readonly SourceBoundary[]): readonly RelativeImportEdge[] {
  return relativeImportEdges().filter((edge) => edge.from === from && forbiddenTargets.includes(edge.to));
}

function withoutExceptions(edges: readonly RelativeImportEdge[], exceptions: readonly BoundaryException[]): readonly RelativeImportEdge[] {
  const allowed = new Set(exceptions.map((exception) => edgeKey(exception)));
  return edges.filter((edge) => !allowed.has(edgeKey(edge)));
}

function relativeImportEdges(): readonly RelativeImportEdge[] {
  return sourceFiles(join(repoRoot, "src"))
    .flatMap((file) => parseRelativeImports(file).map((specifier) => ({ file, specifier, resolved: resolveRelativeImport(file, specifier) })))
    .filter((candidate): candidate is { readonly file: string; readonly specifier: string; readonly resolved: string } => candidate.resolved !== null)
    .flatMap(({ file, specifier, resolved }) => {
      const from = sourceBoundary(file);
      const to = sourceBoundary(resolved);
      if (!from || !to) return [];
      return [{ importer: repoRelative(file), importee: repoRelative(resolved), specifier, from, to }];
    })
    .sort((left, right) => `${left.importer}:${left.importee}`.localeCompare(`${right.importer}:${right.importee}`));
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function parseRelativeImports(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(importSpecifierPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith(".")) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveRelativeImport(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier);
  const candidates = [`${base}.ts`, join(base, "index.ts"), base];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sourceBoundary(path: string): SourceBoundary | null {
  const repoPath = repoRelative(path);
  return SOURCE_BOUNDARIES.find((boundary) => repoPath === `src/${boundary}` || repoPath.startsWith(`src/${boundary}/`)) ?? null;
}

function repoRelative(path: string): string {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function edgeKey(edge: Pick<RelativeImportEdge, "importer" | "importee">): string {
  return `${edge.importer}->${edge.importee}`;
}
