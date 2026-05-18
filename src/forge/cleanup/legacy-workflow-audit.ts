import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type LegacyWorkflowFinding = {
  readonly path: string;
  readonly line: number;
  readonly term: string;
  readonly snippet: string;
};

export type LegacyWorkflowCandidate = {
  readonly priority: "high" | "medium" | "low";
  readonly path: string;
  readonly findingCount: number;
  readonly rationale: string;
  readonly terms: readonly string[];
};

export type LegacyWorkflowAudit = {
  readonly scannedFiles: number;
  readonly findings: readonly LegacyWorkflowFinding[];
  readonly candidates: readonly LegacyWorkflowCandidate[];
};

const SEARCH_TERMS = [
  "compatibility",
  "compat",
  "legacy",
  "removed",
  "backlog",
  "pipeline",
  "closeout",
  "specs",
] as const;

const IGNORED_DIRS = new Set([
  ".git",
  ".desloppify",
  "node_modules",
  "dist",
  "coverage",
  "tmp",
  "legacy",
  "archive",
]);

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".md", ".json", ".jsonc"]);

export function auditLegacyWorkflowReferences(repoRoot: string): LegacyWorkflowAudit {
  const paths = collectScannableFiles(repoRoot);
  const findings = paths.flatMap((path) => scanFile(repoRoot, path));
  return {
    scannedFiles: paths.length,
    findings,
    candidates: rankCandidates(findings),
  };
}

function collectScannableFiles(repoRoot: string): readonly string[] {
  const results: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolutePath = join(directory, entry.name);
      if (shouldScanFile(absolutePath)) results.push(absolutePath);
    }
  }

  visit(repoRoot);
  return results.sort();
}

function shouldScanFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNED_EXTENSIONS.has(path.slice(dot));
}

function scanFile(repoRoot: string, path: string): readonly LegacyWorkflowFinding[] {
  const text = readFileSync(path, "utf8");
  const relativePath = relative(repoRoot, path).replaceAll("\\", "/");
  if (isExplicitlyAllowedPath(relativePath)) return [];

  const findings: LegacyWorkflowFinding[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    for (const term of SEARCH_TERMS) {
      if (!lower.includes(term)) continue;
      if (isAllowedReference(relativePath, line, term)) continue;
      findings.push({
        path: relativePath,
        line: index + 1,
        term,
        snippet: line.trim(),
      });
    }
  }
  return findings;
}

function isExplicitlyAllowedPath(path: string): boolean {
  if (path.startsWith("archive/") || path.includes("/archive/")) return true;
  return path.startsWith("tests/forge-kernel/legacy-workflow-reference-audit.test.ts")
    || path.startsWith("src/forge/cleanup/legacy-workflow-audit.ts")
    || path.startsWith("docs/desloppify-complexity-triage.md")
    || path.startsWith("plan-")
    || path.startsWith("sessions/");
}

function isAllowedReference(path: string, line: string, term: string): boolean {
  const lower = line.toLowerCase();
  if (path.includes("removed-") || path.includes("no-removed") || path.includes("legacy-")) return true;
  if (lower.includes("removed commands are absent") || lower.includes("legacy deletion audit")) return true;
  return false;
}

function rankCandidates(findings: readonly LegacyWorkflowFinding[]): readonly LegacyWorkflowCandidate[] {
  const byPath = new Map<string, LegacyWorkflowFinding[]>();
  for (const finding of findings) {
    byPath.set(finding.path, [...(byPath.get(finding.path) ?? []), finding]);
  }

  return [...byPath.entries()]
    .map(([path, pathFindings]) => {
      const terms = [...new Set(pathFindings.map((finding) => finding.term))].sort();
      return {
        priority: priorityFor(path, pathFindings),
        path,
        findingCount: pathFindings.length,
        rationale: rationaleFor(path, pathFindings),
        terms,
      } satisfies LegacyWorkflowCandidate;
    })
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority) || right.findingCount - left.findingCount || left.path.localeCompare(right.path));
}

function priorityFor(path: string, findings: readonly LegacyWorkflowFinding[]): "high" | "medium" | "low" {
  if (path.startsWith("src/") && findings.some((finding) => ["compatibility", "compat", "legacy", "removed", "backlog", "pipeline", "closeout", "specs"].includes(finding.term))) return "high";
  if (path.startsWith("src/") || findings.length >= 3) return "medium";
  return "low";
}

function priorityWeight(priority: LegacyWorkflowCandidate["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function rationaleFor(path: string, findings: readonly LegacyWorkflowFinding[]): string {
  const terms = [...new Set(findings.map((finding) => finding.term))].sort().join(", ");
  if (path.startsWith("src/")) {
    return `highest-value cleanup candidate: production code still mentions ${terms}`;
  }
  if (path.startsWith("tests/")) {
    return `test-only cleanup candidate: test coverage still encodes ${terms}`;
  }
  return `documentation/tooling cleanup candidate: file still mentions ${terms}`;
}
