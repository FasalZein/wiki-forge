import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { projectRoot, requireValue, safeMatter } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { exists, readText } from "../lib/fs";
import { END_MARKER, PROTOCOL_FILES, START_MARKER, renderProtocolSurface, type ProtocolScope } from "../lib/protocol-source";
import { resolveStateContract } from "../lib/state-contract";
import { resolveRepoPath } from "../lib/verification";
import { parseEntryUpdated } from "../git-utils";
import { collectStaleIndexTargets, writeNamedNavigationTargets } from "../hierarchy";
import { collectRefreshFromWorktree, loadProjectSnapshot } from "./_shared";

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
  if (json) console.log(JSON.stringify(plan, null, 2));
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

  if (options.write) {
    if (navigationTargets.length) await writeNamedNavigationTargets(project, navigationTargets);
    if (protocolWriteTargets.length) await writeProtocolTargets(project, repo, protocolTargets.filter((target) => target.status !== "ok"));
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
      total: navigationTargets.length + protocolWriteTargets.length,
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
  console.log(`sync for ${plan.project}: ${plan.reportOnly ? "REPORT" : "APPLIED"}`);
  console.log(`- repo: ${plan.repo}`);
  console.log(`- dirty authored pages: ${plan.dirtyPages.length}`);
  console.log(`- navigation targets: ${plan.writes.navigationTargets.length}`);
  console.log(`- protocol targets: ${plan.writes.protocolTargets.length}`);
  console.log(`- repo changed files: ${plan.repoChanges.changedFiles.length}`);
  console.log(`- repo impacted pages: ${plan.repoChanges.impactedPages.length}`);
  for (const page of plan.dirtyPages.slice(0, 10)) console.log(`  - dirty: ${page.page} [${page.contractId}]`);
  for (const target of plan.writes.navigationTargets.slice(0, 10)) console.log(`  - nav: ${target}`);
  for (const target of plan.protocol.targets.filter((row) => row.status !== "ok").slice(0, 10)) console.log(`  - protocol: ${target.status} ${target.path}`);
}
