
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { safeMatter } from "../cli-shared";
import { exists, readText } from "./fs";
import { parseWikiMarkdown } from "./markdown-ast";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "./structure";

export type SliceDocKind = "index" | "plan" | "test-plan";

export type VerificationCommandSpec = {
  command: string;
  label: string | null;
  expectedExitCode: number;
  stdoutContains: string[];
  stderrContains: string[];
};

export function sliceDocPaths(project: string, taskId: string) {
  return {
    indexPath: projectTaskHubPath(project, taskId),
    planPath: projectTaskPlanPath(project, taskId),
    testPlanPath: projectTaskTestPlanPath(project, taskId),
  };
}

export async function readSliceSourcePaths(project: string, taskId: string) {
  const sourcePaths = new Set<string>();
  for (const matter of await readSliceMatters(project, taskId)) {
    if (!Array.isArray(matter.data.source_paths)) continue;
    for (const sourcePath of matter.data.source_paths) {
      const normalized = String(sourcePath).replaceAll("\\", "/").trim();
      if (normalized) sourcePaths.add(normalized);
    }
  }
  return [...sourcePaths].sort();
}

export async function readSliceDependencies(project: string, taskId: string) {
  const dependencies = new Set<string>();
  for (const matter of await readSliceMatters(project, taskId)) {
    if (!Array.isArray(matter.data.depends_on)) continue;
    for (const dependency of matter.data.depends_on) {
      const normalized = String(dependency).trim().toUpperCase();
      if (normalized) dependencies.add(normalized);
    }
  }
  return [...dependencies].sort();
}

export async function readSliceDoc(project: string, taskId: string, kind: SliceDocKind) {
  const paths = sliceDocPaths(project, taskId);
  let path: string;
  if (kind === "index") path = paths.indexPath;
  else if (kind === "plan") path = paths.planPath;
  else path = paths.testPlanPath;
  if (!await exists(path)) throw new Error(`${kind} not found: ${relative(VAULT_ROOT, path)}`);
  const raw = await readText(path);
  const parsed = safeMatter(relative(VAULT_ROOT, path), raw);
  if (!parsed) throw new Error(`unable to parse frontmatter for ${relative(VAULT_ROOT, path)}`);
  return { path, raw, content: parsed.content, data: parsed.data };
}

export async function readSliceTestPlan(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "test-plan");
}

export async function readSliceHub(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "index");
}

export async function readSlicePlan(project: string, taskId: string) {
  return readSliceDoc(project, taskId, "plan");
}

export function extractVerificationSpecs(markdown: string): VerificationCommandSpec[] {
  return parseWikiMarkdown(markdown).codeBlocks
    .filter((block) => block.lang === "bash" || block.lang === "sh" || block.lang === "shell")
    .map((block) => parseVerificationCommandSpec(block.value));
}

export function extractShellCommandBlocks(markdown: string) {
  return extractVerificationSpecs(markdown).map((spec) => spec.command);
}

function parseVerificationCommandSpec(block: string): VerificationCommandSpec {
  const stdoutContains: string[] = [];
  const stderrContains: string[] = [];
  let label: string | null = null;
  let expectedExitCode = 0;
  const commandLines: string[] = [];
  let parsingDirectives = true;

  for (const rawLine of block.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (parsingDirectives) {
      if (!trimmed) continue;
      const directive = parseVerificationDirective(trimmed);
      if (directive) {
        if (directive.kind === "label") label = directive.value;
        else if (directive.kind === "expected-exit-code") expectedExitCode = directive.value;
        else if (directive.kind === "stdout-contains") stdoutContains.push(directive.value);
        else stderrContains.push(directive.value);
        continue;
      }
      parsingDirectives = false;
    }
    commandLines.push(rawLine);
  }

  const command = commandLines.join("\n").trim();
  if (!command) throw new Error("verification command block is missing a command");
  return { command, label, expectedExitCode, stdoutContains, stderrContains };
}

function parseVerificationDirective(line: string):
  | { kind: "label"; value: string }
  | { kind: "expected-exit-code"; value: number }
  | { kind: "stdout-contains" | "stderr-contains"; value: string }
  | null {
  const match = line.match(/^#\s*([a-z0-9-]+)\s*:\s*(.+)$/iu);
  if (!match) return null;
  const [, key, rawValue] = match;
  const value = rawValue.trim();
  if (!value) throw new Error(`verification directive is missing a value: ${line}`);
  switch (key.toLowerCase()) {
    case "label":
      return { kind: "label", value };
    case "expect-exit-code": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed)) throw new Error(`invalid expect-exit-code value: ${value}`);
      return { kind: "expected-exit-code", value: parsed };
    }
    case "expect-stdout-contains":
      return { kind: "stdout-contains", value };
    case "expect-stderr-contains":
      return { kind: "stderr-contains", value };
    default:
      if (key.toLowerCase().startsWith("expect-")) throw new Error(`unsupported verification directive: ${key}`);
      return null;
  }
}

export async function readSliceAssignee(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    if (typeof matter.data.assignee === "string" && matter.data.assignee.trim()) return matter.data.assignee.trim();
  }
  return null;
}

export async function readSliceStatus(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    if (typeof matter.data.status === "string" && matter.data.status.trim()) return matter.data.status.trim();
  }
  return null;
}

export async function readSliceCompletedAt(project: string, taskId: string) {
  for (const matter of await readSliceMatters(project, taskId)) {
    if (typeof matter.data.completed_at === "string" && matter.data.completed_at.trim()) return matter.data.completed_at.trim();
  }
  return null;
}

async function readSliceMatters(project: string, taskId: string) {
  const paths = (await Promise.all(Object.entries(sliceDocPaths(project, taskId)).map(async ([, path]) => (await exists(path) ? path : null)))).filter((p): p is string => p !== null);
  const results = await Promise.all(
    paths.map(async (path) => {
      const raw = await readText(path);
      const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
      if (!parsed) return null;
      return { path, content: parsed.content, data: parsed.data };
    }),
  );
  return results.filter((m): m is { path: string; content: string; data: Record<string, unknown> } => m !== null);
}

export async function readSliceSummary(project: string, taskId: string) {
  const matters = await readSliceMatters(project, taskId);
  let status: string | null = null;
  let completedAt: string | null = null;
  let assignee: string | null = null;
  const dependencies = new Set<string>();
  for (const matter of matters) {
    if (!status && typeof matter.data.status === "string" && matter.data.status.trim()) status = matter.data.status.trim();
    if (!completedAt && typeof matter.data.completed_at === "string" && matter.data.completed_at.trim()) completedAt = matter.data.completed_at.trim();
    if (!assignee && typeof matter.data.assignee === "string" && matter.data.assignee.trim()) assignee = matter.data.assignee.trim();
    if (Array.isArray(matter.data.depends_on)) {
      for (const dependency of matter.data.depends_on) {
        const normalized = String(dependency).trim().toUpperCase();
        if (normalized) dependencies.add(normalized);
      }
    }
  }
  return { status, completedAt, assignee, dependencies: [...dependencies].sort() };
}
