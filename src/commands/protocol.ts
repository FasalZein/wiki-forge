import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { orderFrontmatter, projectRoot, requireValue } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { safeMatter } from "../cli-shared";
import { resolveRepoPath } from "../lib/verification";
import { exists, readText } from "../lib/fs";

type ProtocolScope = {
  path: string;
  scope: string;
};

type ProtocolAuditRow = {
  scope: string;
  file: string;
  path: string;
  status: "ok" | "missing" | "stale";
};

const PROTOCOL_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const START_MARKER = "<!-- wiki-forge:agent-protocol:start -->";
const END_MARKER = "<!-- wiki-forge:agent-protocol:end -->";
const PROTOCOL_VERSION = 1;

export async function syncProtocol(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  const json = args.includes("--json");
  const scopes = await readProtocolScopes(project);
  const results: Array<{ scope: string; file: string; path: string; updated: boolean }> = [];

  for (const scope of scopes) {
    for (const file of PROTOCOL_FILES) {
      const path = protocolFilePath(repo, scope.path, file);
      mkdirSync(dirname(path), { recursive: true });
      const next = renderProtocolFile(project, scope);
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
  const repo = resolveRepoPath(project, repoIndex >= 0 ? args[repoIndex + 1] : undefined);
  const json = args.includes("--json");
  const scopes = await readProtocolScopes(project);
  const rows: ProtocolAuditRow[] = [];

  for (const scope of scopes) {
    const expected = renderProtocolFile(project, scope);
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

function renderProtocolFile(project: string, scope: ProtocolScope) {
  const data = orderFrontmatter({
    managed_by: "wiki-forge",
    protocol_version: PROTOCOL_VERSION,
    project,
    scope: scope.scope,
    applies_to: scope.path,
  }, ["managed_by", "protocol_version", "project", "scope", "applies_to"]);
  const frontmatter = [
    "---",
    ...Object.entries(data).flatMap(([key, value]) => Array.isArray(value)
      ? [`${key}:`, ...value.map((item) => `  - ${item}`)]
      : [`${key}: ${String(value)}`]),
    "---",
    "",
  ].join("\n");
  const scopeLine = scope.scope === "root" ? "Scope: repo root" : `Scope: ${scope.scope}`;
  return [
    frontmatter.trimEnd(),
    START_MARKER,
    "# Agent Protocol",
    "",
    "> Managed by wiki-forge. Keep local repo-specific notes below the managed block.",
    "> `AGENTS.md` and `CLAUDE.md` carry the same sync-managed protocol block. Do not treat them as separate policy sources.",
    "",
    `${scopeLine}`,
    "",
    "Use `/forge` for non-trivial implementation work.",
    "Use `/wiki` for retrieval, refresh, drift, verification, and closeout review.",
    "If slash-skill aliases are unavailable, run the equivalent `wiki` CLI lifecycle directly.",
    "`wiki protocol sync` only syncs this managed block; it does not enforce behavior or sync skill policy.",
    "",
    "## Wiki Protocol",
    "",
    "Before starting slice work:",
    `- \`wiki start-slice ${project} <slice-id> --agent <name> --repo <path>\``,
    "",
    "During work:",
    `- \`wiki checkpoint ${project} --repo <path>\``,
    `- \`wiki lint-repo ${project} --repo <path>\``,
    "",
    "Before completion:",
    `- \`wiki maintain ${project} --repo <path> --base <rev>\``,
    `- update impacted wiki pages from code and tests`,
    `- \`wiki verify-page ${project} <page...> <level>\``,
    `- \`wiki verify-slice ${project} <slice-id> --repo <path>\``,
    `- \`wiki closeout ${project} --repo <path> --base <rev>\``,
    `- \`wiki gate ${project} --repo <path> --base <rev>\``,
    `- \`wiki close-slice ${project} <slice-id> --repo <path> --base <rev>\``,
    "",
    END_MARKER,
  ].join("\n");
}

function extractManagedBlock(content: string) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) return "";
  const prefix = content.slice(0, end + END_MARKER.length).trimEnd();
  return prefix;
}

function extractRemainder(content: string) {
  const end = content.indexOf(END_MARKER);
  if (end < 0) return content.trimStart();
  return content.slice(end + END_MARKER.length).trimStart();
}
