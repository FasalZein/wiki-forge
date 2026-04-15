import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULE_REQUIRED_HEADINGS, PROJECT_DIRS, PROJECT_FILES, VAULT_ROOT, type VerificationLevel } from "../constants";
import { assertExists, projectRoot, requireValue, safeMatter } from "../cli-shared";
import { extractWikilinkTargets, parseWikiMarkdown } from "../lib/markdown-ast";
import { buildNoteIndex } from "../lib/notes";
import { classifyProjectDocPath, describeAllowedProjectDocPaths } from "../lib/structure";
import { readText } from "../lib/fs";
import { readVerificationLevel } from "../lib/verification";
import { walkMarkdown } from "../lib/vault";
import { lintFrontmatter, lintWikilinks } from "../module-format";

export type LintingSnapshot = {
  project: string;
  root: string;
  pages: string[];
  noteIndex?: Awaited<ReturnType<typeof buildNoteIndex>>;
  pageEntries: Array<{
    file: string;
    relPath: string;
    vaultPath: string;
    raw: string;
    parsed: ReturnType<typeof safeMatter>;
    sourcePaths: string[];
    rawUpdated: unknown;
    verificationLevel: VerificationLevel | null;
  }>;
};

const MODULE_REQUIRED_LEVELS = ["scaffold", "inferred", "code-verified", "runtime-verified", "test-verified"];

export async function statusProject(args: string[]) {
  const json = args.includes("--json");
  const project = args.find((arg) => !arg.startsWith("--"));
  const projectsRoot = join(VAULT_ROOT, "projects");
  const projects = project ? [project] : existsSync(projectsRoot) ? readdirSync(projectsRoot).filter((entry) => statSync(join(projectsRoot, entry)).isDirectory()) : [];
  const rows = await Promise.all(projects.map((name) => collectStatusRow(name)));
  if (json) console.log(JSON.stringify(rows, null, 2));
  else for (const row of rows) console.log(`${row.project}: modules=${row.modules} pages=${row.pages} bound=${row.bound} unbound=${row.unbound} stale=${row.stale} root=${row.root}`);
}

export async function lintSemanticProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");
  const result = await collectSemanticLintResult(project);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.issues.length) {
    console.log(`semantic lint found ${result.issues.length} issue(s) for ${project}:`);
    for (const issue of result.issues) console.log(`- ${issue}`);
  } else console.log(`semantic lint passed for ${project}`);
  if (result.issues.length) throw new Error(`semantic lint failed for ${project}`);
}

export async function lintProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");
  const result = await collectLintResult(project);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.issues.length) {
    console.log(`lint found ${result.issues.length} issue(s) for ${project}:`);
    for (const issue of result.issues) console.log(`- ${issue}`);
  } else console.log(`lint passed for ${project}`);
  if (result.issues.length) throw new Error(`lint failed for ${project}`);
}

export async function verifyProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");
  const summary = await collectVerifySummary(project);
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`verification summary for ${project}:`);
    console.log(`- pages: ${summary.pages}`);
    console.log(`- module specs: ${summary.moduleSpecs}`);
    console.log(`- stale: ${summary.stale}`);
    console.log(`- untracked verification: ${summary.untracked}`);
    console.log(`- unbound pages: ${summary.unboundPages.length}`);
    console.log(`- levels: ${Object.entries(summary.byLevel).filter(([, count]) => count > 0).map(([level, count]) => `${level}=${count}`).join(" ") || "none"}`);
  }
}

export function cacheClear() {
  const cachePath = join(VAULT_ROOT, ".cache", "wiki-cli");
  if (!existsSync(cachePath)) return console.log("cache already empty");
  rmSync(cachePath, { recursive: true, force: true });
  console.log(`cleared ${relative(VAULT_ROOT, cachePath)}`);
}

export async function loadLintingSnapshot(project: string, options: { noteIndex?: boolean } = {}): Promise<LintingSnapshot> {
  const root = projectRoot(project);
  assertExists(root, `project not found: ${project}`);
  const pages = walkMarkdown(root);
  const pageEntries = await Promise.all(pages.map(async (file) => {
    const raw = await readText(file);
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    return {
      file,
      relPath: relative(root, file).replaceAll("\\", "/"),
      vaultPath: relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/"),
      raw,
      parsed,
      sourcePaths: parsed && Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths.map((value: unknown) => String(value).replaceAll("\\", "/")) : [],
      rawUpdated: parsed?.data.updated,
      verificationLevel: parsed ? readVerificationLevel(parsed.data) : null,
    };
  }));
  return { project, root, pages, noteIndex: options.noteIndex ? await buildNoteIndex() : undefined, pageEntries };
}

export async function collectStatusRow(project: string, snapshot?: LintingSnapshot) {
  const state = snapshot ?? await loadLintingSnapshot(project);
  const modulesRoot = join(state.root, "modules");
  const modules = existsSync(modulesRoot) ? readdirSync(modulesRoot).filter((entry) => statSync(join(modulesRoot, entry)).isDirectory()).length : 0;
  let bound = 0;
  let stale = 0;
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    if (entry.sourcePaths.length > 0) bound += 1;
    if (entry.verificationLevel === "stale") stale += 1;
  }
  return { project, modules, pages: state.pages.length, bound, unbound: state.pages.length - bound, stale, root: relative(VAULT_ROOT, state.root) };
}

export async function collectVerifySummary(project: string, snapshot?: LintingSnapshot) {
  const state = snapshot ?? await loadLintingSnapshot(project);
  const summary = { project, pages: state.pages.length, moduleSpecs: 0, stale: 0, untracked: 0, byLevel: Object.fromEntries(["stale", ...MODULE_REQUIRED_LEVELS].map((level) => [level, 0])) as Record<string, number>, unboundPages: [] as string[] };
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    if (entry.file.endsWith("/spec.md")) summary.moduleSpecs += 1;
    const level = entry.verificationLevel;
    if (entry.sourcePaths.length === 0) summary.unboundPages.push(entry.relPath);
    if (!level) summary.untracked += 1;
    else {
      summary.byLevel[level] = (summary.byLevel[level] ?? 0) + 1;
      if (level === "stale") summary.stale += 1;
    }
  }
  return summary;
}

export async function collectLintResult(project: string, snapshot?: LintingSnapshot) {
  const state = snapshot ?? await loadLintingSnapshot(project, { noteIndex: true });
  const issues: string[] = [];
  for (const dir of PROJECT_DIRS) if (!existsSync(join(state.root, dir))) issues.push(`missing directory: ${dir}`);
  for (const file of PROJECT_FILES) if (!existsSync(join(state.root, file))) issues.push(`missing file: ${file}`);
  const noteIndex = state.noteIndex ?? await buildNoteIndex();
  for (const entry of state.pageEntries) {
    if (!classifyProjectDocPath(entry.relPath)) issues.push(`${entry.relPath} invalid project doc path: expected ${describeAllowedProjectDocPaths()}`);
    const frontmatterResult = lintFrontmatter(entry.vaultPath, entry.raw, safeMatter);
    if (frontmatterResult.error) { issues.push(`${entry.relPath} invalid frontmatter: ${frontmatterResult.error}`); continue; }
    if (frontmatterResult.missingFields.length > 0) issues.push(`${entry.relPath} missing frontmatter fields: ${frontmatterResult.missingFields.join(", ")}`);
    for (const issue of lintWikilinks(entry.vaultPath, frontmatterResult.body, noteIndex)) issues.push(`${entry.relPath} ${issue}`);
    if (entry.vaultPath.includes("/modules/") && entry.vaultPath.endsWith("/spec")) {
      const parsed = parseWikiMarkdown(frontmatterResult.body);
      const headingTexts = new Set(parsed.headings.map((h) => `${"#".repeat(h.depth)} ${h.text}`));
      for (const heading of MODULE_REQUIRED_HEADINGS) if (!headingTexts.has(heading)) issues.push(`${entry.relPath} missing required heading: ${heading}`);
    }
  }
  return { project, issues };
}

export async function collectSemanticLintResult(project: string, snapshot?: LintingSnapshot) {
  const state = snapshot ?? await loadLintingSnapshot(project);
  const pageEntries = [...state.pageEntries].sort((a, b) => a.relPath.localeCompare(b.relPath));
  const pageSet = new Set(pageEntries.map((entry) => entry.relPath.replace(/\.md$/u, "")));
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const issues: string[] = [];
  for (const entry of pageEntries) {
    const rel = entry.relPath;
    const relNoExt = rel.replace(/\.md$/u, "");
    const links = extractWikilinkTargets(entry.parsed?.content ?? entry.raw);
    const internalLinks = links.map((target) => target.replace(/\.md$/u, "").replace(/^projects\/[^/]+\//u, "")).filter((target) => !target.startsWith("index") && !target.startsWith("wiki/") && !target.startsWith("research/"));
    outbound.set(relNoExt, internalLinks.length);
    for (const target of internalLinks) if (pageSet.has(target.replace(/^\.\//u, ""))) inbound.set(target.replace(/^\.\//u, ""), (inbound.get(target.replace(/^\.\//u, "")) ?? 0) + 1);
    const bodyContent = entry.parsed?.content ?? entry.raw;
    const parsedPage = parseWikiMarkdown(bodyContent);
    if (parsedPage.todoCount >= 6) issues.push(`${rel} placeholder-heavy: ${parsedPage.todoCount} TODO markers`);
    const bodyLength = bodyContent.trim().length;
    if (bodyLength > 0 && bodyLength < 180 && !rel.endsWith("backlog.md") && !rel.endsWith("decisions.md") && !rel.endsWith("learnings.md")) issues.push(`${rel} thin page: very little maintained content`);
    if (entry.parsed && (!Array.isArray(entry.parsed.data.source_paths) || entry.parsed.data.source_paths.length === 0) && rel.includes("/modules/")) issues.push(`${rel} module page has no source_paths`);
    if (rel.startsWith("specs/") || rel.includes("/specs/")) {
      const kind = classifyProjectDocPath(rel);
      if (!entry.raw.includes("[[projects/")) issues.push(`${rel} spec page missing cross-links to project pages`);
      if (kind === "spec-prd" && !entry.raw.includes("Acceptance Criteria")) issues.push(`${rel} PRD missing acceptance criteria section`);
      if (kind === "spec-prd" && !entry.raw.includes("Prior Research")) issues.push(`${rel} PRD missing prior research section`);
      if (kind === "spec-prd" && entry.raw.includes("Prior Research") && !entry.raw.includes("[[research/")) issues.push(`${rel} PRD has no research links in Prior Research section`);
      if ((kind === "spec-test-plan" || kind === "task-hub-test-plan") && !entry.raw.includes("Red Tests")) issues.push(`${rel} test plan missing TDD structure`);
    }
  }
  for (const entry of pageEntries) {
    const relNoExt = entry.relPath.replace(/\.md$/u, "");
    const inboundCount = inbound.get(relNoExt) ?? 0;
    const outboundCount = outbound.get(relNoExt) ?? 0;
    const rel = `${relNoExt}.md`;
    if (!rel.endsWith("_summary.md") && !rel.endsWith("specs/index.md") && inboundCount === 0) issues.push(`${rel} orphan page: no inbound links`);
    if (!rel.endsWith("_summary.md") && outboundCount === 0) issues.push(`${rel} dead-end page: no outgoing links`);
  }
  return { project, issues };
}
