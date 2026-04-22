import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { projectRoot, requireValue, safeMatter } from "../../cli-shared";
import { VAULT_ROOT } from "../../constants";
import { exists, readText } from "../../lib/fs";
import { resolveRepoPath } from "../../lib/verification";
import { type ProtocolScope, PROTOCOL_FILES, START_MARKER, END_MARKER, renderProtocolSurface } from "../source";

type ProtocolAuditRow = {
  scope: string;
  file: string;
  path: string;
  status: "ok" | "missing" | "stale";
};


export async function syncProtocol(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = await resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  const json = args.includes("--json");
  const scopes = await readProtocolScopes(project);
  const results: Array<{ scope: string; file: string; path: string; updated: boolean }> = [];

  for (const scope of scopes) {
    for (const file of PROTOCOL_FILES) {
      const path = protocolFilePath(repo, scope.path, file);
      mkdirSync(dirname(path), { recursive: true });
      const next = renderProtocolSurface(project, scope);
      const current = await exists(path) ? await readText(path) : "";
      const remainder = current ? extractRemainder(current) : "";
      const output = `${next}${remainder ? `\n\n${remainder.trimStart()}` : ""}`.trimEnd() + "\n";
      const updated = output !== current;
      if (updated) writeFileSync(path, output, "utf8");
      results.push({ scope: scope.scope, file, path: relative(repo, path).replaceAll("\\", "/") || file, updated });
    }
  }

  const payload = { project, repo, ok: true, scopes: scopes.map((scope) => scope.scope), files: results };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`protocol sync for ${project}:`);
    for (const row of results) console.log(`- ${row.updated ? "updated" : "ok"}: ${row.path}`);
  }
}

export async function auditProtocol(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = await resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  const json = args.includes("--json");
  const scopes = await readProtocolScopes(project);
  const rows: ProtocolAuditRow[] = [];

  for (const scope of scopes) {
    const expected = renderProtocolSurface(project, scope);
    for (const file of PROTOCOL_FILES) {
      const path = protocolFilePath(repo, scope.path, file);
      const rel = relative(repo, path).replaceAll("\\", "/") || file;
      if (!await exists(path)) {
        rows.push({ scope: scope.scope, file, path: rel, status: "missing" });
        continue;
      }
      const current = await readText(path);
      const managed = extractManagedBlock(current);
      rows.push({ scope: scope.scope, file, path: rel, status: managed === expected ? "ok" : "stale" });
    }
  }

  const payload = {
    project,
    repo,
    ok: rows.every((row) => row.status === "ok"),
    rows,
    missing: rows.filter((row) => row.status === "missing"),
    stale: rows.filter((row) => row.status === "stale"),
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`protocol audit for ${project}: ${payload.ok ? "PASS" : "FAIL"}`);
    for (const row of rows) console.log(`- ${row.status}: ${row.path}`);
  }
  if (!payload.ok) {
    const error = new Error(`protocol audit failed for ${project}`) as Error & { exitCode: number };
    error.exitCode = 1;
    throw error;
  }
}

export async function syncProtocolForProject(project: string, explicitRepo?: string) {
  await syncProtocol([project, ...(explicitRepo ? ["--repo", explicitRepo] : [])]);
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
    if (typeof entry === "string") {
      const normalized = normalizeScopePath(entry);
      if (normalized && !scopes.has(normalized)) scopes.set(normalized, { path: normalized, scope: normalized });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.path !== "string") continue;
    const normalized = normalizeScopePath(record.path);
    if (normalized && !scopes.has(normalized)) scopes.set(normalized, { path: normalized, scope: normalized });
  }
  return [...scopes.values()];
}

function normalizeScopePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "").trim();
  return normalized && normalized !== "." ? normalized : "";
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
