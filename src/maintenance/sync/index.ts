import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { nowIso, orderFrontmatter, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { VAULT_ROOT } from "../../constants";
import { exists, readText } from "../../lib/fs";
import { END_MARKER, PROTOCOL_FILES, START_MARKER, renderProtocolSurface, type ProtocolScope } from "../../protocol/source/index";
import { resolveStateContract } from "../../lib/state-contract";
import { resolveRepoPath } from "../../lib/verification";
import { parseEntryUpdated } from "../../git-utils";
import { collectStaleIndexTargets, writeNamedNavigationTargets } from "../../hierarchy";
import { collectRefreshFromWorktree, loadProjectSnapshot } from "../shared";
import { printJson, printLine } from "../../lib/cli-output";

type DirtyAuthoredPage = {
  page: string;
  contractId: string;
  scope: string;
  updated: string | null;
  lastModified: string;
};

type ProtocolTarget = {
  scope: string;
  file: string;
  path: string;
  status: "ok" | "missing" | "stale";
};

type SyncPlan = {
  project: string;
  repo: string;
  reportOnly: boolean;
  dirtyPages: DirtyAuthoredPage[];
  navigation: {
    staleTargets: string[];
  };
  protocol: {
    targets: ProtocolTarget[];
  };
  repoChanges: Awaited<ReturnType<typeof collectRefreshFromWorktree>>;
  writes: {
    navigationTargets: string[];
    protocolTargets: string[];
    projectTargets: string[];
    total: number;
  };
};

export async function syncProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = await resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  const json = args.includes("--json");
  const write = args.includes("--write") && !args.includes("--report-only");
  const plan = await collectSyncPlan(project, repo, { write });
  if (json) printJson(plan);
  else renderSyncPlan(plan);
}

export async function collectSyncPlan(project: string, explicitRepo?: string, options: { write?: boolean } = {}): Promise<SyncPlan> {
  const repo = await resolveRepoPath(project, explicitRepo);
  const snapshot = await loadProjectSnapshot(project, repo);
  const dirtyPages = collectDirtyAuthoredPages(snapshot);
  const staleTargets = await collectStaleIndexTargets(project);
  const protocolTargets = await collectProtocolTargets(project, repo);
  const repoChanges = await collectRefreshFromWorktree(project, repo, snapshot);

  const navigationTargets = staleTargets;
  const protocolWriteTargets = protocolTargets.filter((target) => target.status !== "ok").map((target) => target.path);
  const projectWriteTargets = collectProjectWriteTargets(repoChanges);

  if (options.write) {
    if (navigationTargets.length) await writeNamedNavigationTargets(project, navigationTargets);
    if (protocolWriteTargets.length) await writeProtocolTargets(project, repo, protocolTargets.filter((target) => target.status !== "ok"));
    if (projectWriteTargets.includes("_summary.md")) await writeProjectSummary(project, repoChanges);
  }

  return {
    project,
    repo,
    reportOnly: !options.write,
    dirtyPages,
    navigation: { staleTargets },
    protocol: { targets: protocolTargets },
    repoChanges,
    writes: {
      navigationTargets,
      protocolTargets: protocolWriteTargets,
      projectTargets: projectWriteTargets,
      total: navigationTargets.length + protocolWriteTargets.length + projectWriteTargets.length,
    },
  };
}

function collectDirtyAuthoredPages(snapshot: Awaited<ReturnType<typeof loadProjectSnapshot>>): DirtyAuthoredPage[] {
  const dirty: DirtyAuthoredPage[] = [];
  for (const entry of snapshot.pageEntries) {
    if (!entry.parsed) continue;
    const contract = resolveStateContract(entry.relPath, entry.parsed.data);
    if (!contract) continue;
    if (contract.scope === "history") continue;
    const updated = parseEntryUpdated(entry.rawUpdated);
    const lastModifiedMs = statSync(entry.file).mtimeMs;
    if (updated && lastModifiedMs <= updated.getTime() + 1000) continue;
    dirty.push({
      page: entry.page,
      contractId: contract.id,
      scope: contract.scope,
      updated: updated?.toISOString() ?? null,
      lastModified: new Date(lastModifiedMs).toISOString(),
    });
  }
  return dirty.sort((left, right) => left.page.localeCompare(right.page));
}

async function collectProtocolTargets(project: string, repo: string): Promise<ProtocolTarget[]> {
  const scopes = await readProtocolScopes(project);
  const rows: ProtocolTarget[] = [];
  for (const scope of scopes) {
    const expected = renderProtocolSurface(project, scope);
    for (const file of PROTOCOL_FILES) {
      const path = relative(repo, protocolFilePath(repo, scope.path, file)).replaceAll("\\", "/") || file;
      const absolutePath = protocolFilePath(repo, scope.path, file);
      if (!await exists(absolutePath)) {
        rows.push({ scope: scope.scope, file, path, status: "missing" });
        continue;
      }
      const current = await readText(absolutePath);
      rows.push({ scope: scope.scope, file, path, status: extractManagedBlock(current) === expected ? "ok" : "stale" });
    }
  }
  return rows;
}

async function readProtocolScopes(project: string): Promise<ProtocolScope[]> {
  const summaryPath = join(projectRoot(project), "_summary.md");
  const scopes = new Map<string, ProtocolScope>();
  scopes.set(".", { path: ".", scope: "root" });
  if (!await exists(summaryPath)) return [...scopes.values()];
  const parsed = safeMatter(relative(VAULT_ROOT, summaryPath), await readText(summaryPath), { silent: true });
  const rawScopes = parsed?.data.protocol_scopes;
  if (!Array.isArray(rawScopes)) return [...scopes.values()];
  for (const entry of rawScopes) {
    const value = typeof entry === "string"
      ? entry
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).path === "string"
        ? String((entry as Record<string, unknown>).path)
        : null;
    if (!value) continue;
    const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "").trim();
    if (!normalized || scopes.has(normalized)) continue;
    scopes.set(normalized, { path: normalized, scope: normalized });
  }
  return [...scopes.values()];
}

async function writeProtocolTargets(project: string, repo: string, targets: ProtocolTarget[]) {
  const scopeMap = new Map<string, ProtocolScope>();
  for (const scope of await readProtocolScopes(project)) scopeMap.set(scope.scope, scope);
  for (const target of targets) {
    const scope = scopeMap.get(target.scope);
    if (!scope) continue;
    const absolutePath = protocolFilePath(repo, scope.path, target.file);
    mkdirSync(dirname(absolutePath), { recursive: true });
    const next = renderProtocolSurface(project, scope);
    const current = await exists(absolutePath) ? await readText(absolutePath) : "";
    const remainder = current ? extractRemainder(current) : "";
    const output = `${next}${remainder ? `\n\n${remainder.trimStart()}` : ""}`.trimEnd() + "\n";
    writeFileSync(absolutePath, output, "utf8");
  }
}

function collectProjectWriteTargets(repoChanges: Awaited<ReturnType<typeof collectRefreshFromWorktree>>) {
  return repoChanges.impactedPages
    .filter((page) => page.page === "_summary.md" && page.stale)
    .map((page) => page.page);
}

async function writeProjectSummary(project: string, repoChanges: Awaited<ReturnType<typeof collectRefreshFromWorktree>>) {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!await exists(summaryPath)) return;
  const raw = await readText(summaryPath);
  const parsed = safeMatter(relative(VAULT_ROOT, summaryPath), raw, { silent: true });
  if (!parsed) return;

  let content = parsed.content.trim();
  const currentFocus = extractSection(content, "Current Focus");
  if (shouldRewriteCurrentFocus(currentFocus)) {
    content = upsertSection(content, "Current Focus", buildCurrentFocusBody(repoChanges));
  }
  content = upsertSection(content, "Change Digest", buildChangeDigestBody(repoChanges));

  writeNormalizedPage(
    summaryPath,
    content,
    orderFrontmatter(
      {
        ...parsed.data,
        updated: nowIso(),
      },
      ["title", "type", "project", "repo", "code_paths", "source_paths", "updated", "status", "verification_level", "protocol_scopes"],
    ),
  );
}

function buildCurrentFocusBody(repoChanges: Awaited<ReturnType<typeof collectRefreshFromWorktree>>) {
  const lines = ["<!-- generated: sync-current-focus -->"];
  if (repoChanges.changedFiles.length > 0) {
    lines.push(`- Repo worktree has ${repoChanges.changedFiles.length} changed file(s).`);
  }
  if (repoChanges.impactedPages.length > 0) {
    lines.push(`- ${repoChanges.impactedPages.length} bound wiki page(s) are impacted by current repo changes.`);
  }
  if (repoChanges.outsideActiveHierarchyFiles.length > 0) {
    lines.push(`- ${repoChanges.outsideActiveHierarchyFiles.length} changed file(s) sit outside the active slice hierarchy.`);
  }
  return lines.join("\n");
}

function buildChangeDigestBody(repoChanges: Awaited<ReturnType<typeof collectRefreshFromWorktree>>) {
  const summaryEntry = repoChanges.impactedPages.find((page) => page.page === "_summary.md");
  const lines = [
    "<!-- generated: sync-change-digest -->",
    repoChanges.base === "WORKTREE"
      ? "- Updated from current worktree changes"
      : `- Updated from git diff base \`${repoChanges.base}\``,
  ];
  if (summaryEntry) {
    for (const source of summaryEntry.matchedSourcePaths) lines.push(`- Source: \`${source}\``);
    lines.push(`- Last source change: \`${summaryEntry.lastSourceChange}\``);
  } else {
    lines.push(`- Changed files: ${repoChanges.changedFiles.length}`);
  }
  return lines.join("\n");
}

function shouldRewriteCurrentFocus(section: string) {
  const normalized = section.trim();
  return normalized.length === 0 || normalized === "-" || normalized.includes("<!-- generated: sync-current-focus -->");
}

function extractSection(markdown: string, heading: string) {
  const sections = markdown.split(/^## /mu);
  for (const section of sections) {
    const firstLineEnd = section.indexOf("\n");
    if (firstLineEnd === -1) continue;
    const sectionHeading = section.slice(0, firstLineEnd).trim();
    if (sectionHeading === heading) return section.slice(firstLineEnd).trim();
  }
  return "";
}

function upsertSection(markdown: string, heading: string, body: string) {
  const marker = `## ${heading}`;
  const sectionStart = markdown.indexOf(`\n${marker}\n`);
  if (sectionStart === -1) return `${markdown.trimEnd()}\n\n${marker}\n\n${body.trim()}\n`;
  const bodyStart = sectionStart + marker.length + 2;
  const nextHeading = markdown.indexOf("\n## ", bodyStart);
  const bodyEnd = nextHeading === -1 ? markdown.length : nextHeading;
  return `${markdown.slice(0, bodyStart)}${body.trim()}\n\n${markdown.slice(bodyEnd).trimStart()}`.trimEnd();
}

function protocolFilePath(repo: string, scopePath: string, file: string) {
  return join(repo, scopePath === "." ? "" : scopePath, file);
}

function extractManagedBlock(content: string) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) return "";
  return content.slice(0, end + END_MARKER.length).trimEnd();
}

function extractRemainder(content: string) {
  const end = content.indexOf(END_MARKER);
  if (end < 0) return content.trimStart();
  return content.slice(end + END_MARKER.length).trimStart();
}

function renderSyncPlan(plan: SyncPlan) {
  printLine(`sync for ${plan.project}: ${plan.reportOnly ? "REPORT" : "APPLIED"}`);
  printLine(`- repo: ${plan.repo}`);
  printLine(`- dirty authored pages: ${plan.dirtyPages.length}`);
  printLine(`- navigation targets: ${plan.writes.navigationTargets.length}`);
  printLine(`- protocol targets: ${plan.writes.protocolTargets.length}`);
  printLine(`- project targets: ${plan.writes.projectTargets.length}`);
  printLine(`- repo changed files: ${plan.repoChanges.changedFiles.length}`);
  printLine(`- repo impacted pages: ${plan.repoChanges.impactedPages.length}`);
  for (const page of plan.dirtyPages.slice(0, 10)) printLine(`  - dirty: ${page.page} [${page.contractId}]`);
  for (const target of plan.writes.navigationTargets.slice(0, 10)) printLine(`  - nav: ${target}`);
  for (const target of plan.protocol.targets.filter((row) => row.status !== "ok").slice(0, 10)) printLine(`  - protocol: ${target.status} ${target.path}`);
  for (const target of plan.writes.projectTargets.slice(0, 10)) printLine(`  - project: ${target}`);
}
