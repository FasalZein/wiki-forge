import { mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { orderFrontmatter, projectRoot, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { normalizeTopicPath } from "../../lib/research";
import { normalizePath, walkMarkdown } from "../../lib/vault";
import { printJson, printLine } from "../../lib/cli-output";

export type ProjectResearchMigration = {
  readonly from: string;
  readonly to: string;
  readonly project: string;
  readonly topic: string;
  readonly status: "ready" | "migrated" | "blocked";
  readonly reason?: string;
};

export async function migrateProjectResearch(args: string[]) {
  const project = readFlagValue(args, "--project");
  const targetProject = readFlagValue(args, "--to-project");
  if (targetProject && !project) throw new Error("--to-project requires --project to name the legacy source project");
  const write = args.includes("--write");
  const json = args.includes("--json");
  const migrations = await collectProjectResearchMigrations(project, targetProject, write);
  const removedEmptyDirs = write ? pruneEmptyLegacyDirs(project) : [];
  const payload = {
    write,
    project: project ?? null,
    targetProject: targetProject ?? null,
    migrations,
    removedEmptyDirs,
    counts: {
      total: migrations.length,
      ready: migrations.filter((item) => item.status === "ready").length,
      migrated: migrations.filter((item) => item.status === "migrated").length,
      blocked: migrations.filter((item) => item.status === "blocked").length,
    },
  };
  if (json) return printJson(payload);
  printLine(`${write ? "migrated" : "would migrate"} ${payload.counts[write ? "migrated" : "ready"]} legacy project research page(s)`);
  for (const migration of migrations) {
    const detail = migration.reason ? ` (${migration.reason})` : "";
    printLine(`- ${migration.status}: ${migration.from} -> ${migration.to}${detail}`);
  }
  for (const dir of removedEmptyDirs) printLine(`- removed empty legacy dir: ${dir}`);
  if (!write && payload.counts.ready > 0) printLine("dry run only; pass --write to move files");
}

async function collectProjectResearchMigrations(project: string | undefined, targetProject: string | undefined, write: boolean): Promise<ProjectResearchMigration[]> {
  const legacyRoot = join(VAULT_ROOT, "research", "projects", project ?? "");
  const files = await walkMarkdown(legacyRoot);
  const migrations: ProjectResearchMigration[] = [];
  for (const file of files.sort()) {
    const from = normalizePath(relative(VAULT_ROOT, file));
    if (project && !from.startsWith(`research/projects/${project}/`)) continue;
    const migration = await planMigration(file, targetProject, write);
    migrations.push(migration);
  }
  return migrations;
}

async function planMigration(file: string, targetProject: string | undefined, write: boolean): Promise<ProjectResearchMigration> {
  const from = normalizePath(relative(VAULT_ROOT, file));
  const match = from.match(/^research\/projects\/([^/]+)\/(.+\.md)$/u);
  if (!match) return blocked(from, from, "unknown", "migrated", "not under research/projects/<project>");
  const sourceProject = match[1] ?? "unknown";
  const project = targetProject ?? sourceProject;
  const rest = match[2] ?? basename(file);
  const topic = inferTopic(rest);
  const destination = join(projectRoot(project), "research", ...topic.split("/"), basename(rest));
  const to = normalizePath(relative(VAULT_ROOT, destination));
  if (!await exists(projectRoot(project))) return blocked(from, to, project, topic, `project not found: ${project}`);
  if (await exists(destination)) return blocked(from, to, project, topic, "destination exists");
  if (write) await moveResearchPage(file, destination, project, topic);
  return { from, to, project, topic, status: write ? "migrated" : "ready" };
}

async function moveResearchPage(source: string, destination: string, project: string, topic: string): Promise<void> {
  const raw = await readText(source);
  const parsed = safeMatter(normalizePath(relative(VAULT_ROOT, source)), raw, { silent: true });
  mkdirSync(dirname(destination), { recursive: true });
  if (parsed) {
    const data = orderFrontmatter({
      ...parsed.data,
      project,
      topic,
    }, ["title", "type", "project", "topic", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
    writeNormalizedPage(destination, parsed.content.trimStart(), data);
  } else {
    await Bun.write(destination, raw);
  }
  rmSync(source);
}

function pruneEmptyLegacyDirs(project: string | undefined): readonly string[] {
  const root = join(VAULT_ROOT, "research", "projects", project ?? "");
  const removed: string[] = [];
  pruneEmptyDirs(root, removed);
  return removed.map((dir) => normalizePath(relative(VAULT_ROOT, dir))).sort();
}

function pruneEmptyDirs(root: string, removed: string[]): boolean {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
  let hasRemainingEntries = false;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (pruneEmptyDirs(path, removed)) continue;
      hasRemainingEntries = true;
    } else {
      hasRemainingEntries = true;
    }
  }
  if (hasRemainingEntries || root === join(VAULT_ROOT, "research", "projects")) return false;
  rmdirSync(root);
  removed.push(root);
  return true;
}

function inferTopic(rest: string): string {
  const parent = dirname(rest).replaceAll("\\", "/");
  if (parent && parent !== ".") return normalizeTopicPath(parent);
  return "migrated";
}

function blocked(from: string, to: string, project: string, topic: string, reason: string): ProjectResearchMigration {
  return { from, to, project, topic, status: "blocked", reason };
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
