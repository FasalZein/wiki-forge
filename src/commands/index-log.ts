import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { createdAt, mkdirIfMissing, projectRoot, requireValue, safeMatter } from "../cli-shared";
import { readText, writeText } from "../lib/fs";
import { tailLog, appendLogEntry } from "../lib/log";
import { walkMarkdown } from "../lib/vault";

export async function updateIndex(args: string[]) {
  const json = args.includes("--json");
  const write = args.includes("--write");
  const all = args.includes("--all");
  const project = all ? undefined : args.find((arg) => !arg.startsWith("--"));
  if (!all) requireValue(project, "project or --all");
  const result = await buildIndexPlan(project, all);
  if (write) await applyIndexPlan(result);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${write ? "updated" : "would update"} ${result.targets.length} index file(s)`);
    for (const target of result.targets) console.log(`- ${target.path}`);
  }
}

export function logCommand(args: string[]) {
  const subcommand = args[0] ?? "tail";
  if (subcommand === "append") {
    const kind = args[1];
    const title = args[2];
    requireValue(kind, "kind");
    requireValue(title, "title");
    const projectIndex = args.indexOf("--project");
    const detailsIndex = args.indexOf("--details");
    appendLogEntry(kind, title, {
      project: projectIndex >= 0 ? args[projectIndex + 1] : undefined,
      details: detailsIndex >= 0 ? [args.slice(detailsIndex + 1).join(" ").trim()].filter(Boolean) : [],
    });
    return console.log(`appended log entry: ${kind} | ${title}`);
  }
  const count = subcommand === "tail" ? Number.parseInt(args[1] ?? "10", 10) : 10;
  for (const entry of tailLog(Number.isFinite(count) && count > 0 ? count : 10)) console.log(`${entry}\n`);
}

async function buildIndexPlan(project: string | undefined, all: boolean) {
  const targets: Array<{ path: string; content: string }> = [];
  if (all) {
    const projectsRoot = join(VAULT_ROOT, "projects");
    const projects = existsSync(projectsRoot) ? readdirSync(projectsRoot).filter((entry) => statSync(join(projectsRoot, entry)).isDirectory()).sort() : [];
    const lines = ["# Index", "", "## Projects", ""];
    const projectTitles = await Promise.all(projects.map(async (name) => {
      const summaryPath = join(projectRoot(name), "_summary.md");
      return { name, title: existsSync(summaryPath) ? await readPageTitle(summaryPath) : name };
    }));
    for (const { name, title } of projectTitles) lines.push(`- [[projects/${name}/_summary|${title}]]`);
    lines.push("");
    targets.push({ path: "index.md", content: `${lines.join("\n")}\n` });
    targets.push(...await Promise.all(projects.map((name) => buildProjectIndexTarget(name))));
    return { all, project: null, targets };
  }
  targets.push(await buildProjectIndexTarget(project!));
  return { all, project: project!, targets };
}

async function applyIndexPlan(plan: { targets: Array<{ path: string; content: string }> }) {
  for (const target of plan.targets) {
    const absolutePath = join(VAULT_ROOT, target.path);
    mkdirIfMissing(dirname(absolutePath));
    await writeText(absolutePath, target.content);
  }
}

export async function writeProjectIndex(project: string) {
  const target = await buildProjectIndexTarget(project);
  const absolutePath = join(VAULT_ROOT, target.path);
  mkdirIfMissing(dirname(absolutePath));
  await writeText(absolutePath, target.content);
  return target;
}

async function buildProjectIndexTarget(project: string) {
  const root = projectRoot(project);
  const pages = walkMarkdown(root).sort();
  const sections = new Map<string, Array<{ line: string; sortKey: string }>>();
  const pageRows = await Promise.all(pages.map(async (file) => {
    const rel = relative(root, file).replaceAll("\\", "/");
    const raw = await readText(file);
    const parsed = safeMatter(relative(VAULT_ROOT, file), raw, { silent: true });
    const title = readTitleFromParsed(parsed, file);
    return { file, rel, title, parsed };
  }));
  for (const { file, rel, title, parsed } of pageRows) {
    const section = rel.includes("/") ? rel.split("/")[0] : "root";
    const vaultPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
    const lines = sections.get(section) ?? [];
    lines.push({ line: `- [[${vaultPath}|${title}]]`, sortKey: buildSectionSortKey(section, rel, parsed?.data) });
    sections.set(section, lines);
  }
  const out = [`# ${project} Index`, "", `- [[projects/${project}/_summary|${project} summary]]`, ""];
  for (const [section, lines] of [...sections.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${section}`, "", ...lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((entry) => entry.line), "");
  }
  return { path: `projects/${project}/specs/index.md`, content: `${out.join("\n")}\n` };
}

async function readPageTitle(file: string) {
  const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
  return readTitleFromParsed(parsed, file);
}

function readTitleFromParsed(parsed: ReturnType<typeof safeMatter> | null | undefined, file: string) {
  const title = parsed?.data.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const heading = parsed?.content.split("\n").find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s+/u, "").trim() || relative(VAULT_ROOT, file).replace(/\.md$/u, "");
}

function buildSectionSortKey(section: string, rel: string, data: Record<string, unknown> | undefined) {
  if (section !== "specs") return rel;
  const kindOrder = { prd: "0", plan: "1", "test-plan": "2" } as const;
  const kind = typeof data?.spec_kind === "string" ? data.spec_kind : "zzz";
  const taskId = typeof data?.task_id === "string" ? data.task_id : "";
  const taskMatch = taskId.match(/(\d{3,})$/);
  const taskNumber = taskMatch ? taskMatch[1].padStart(6, "0") : "000000";
  const created = createdAt((data ?? {}) as Record<string, unknown>);
  return `${created}:${kindOrder[kind as keyof typeof kindOrder] ?? "9"}:${taskNumber}:${rel}`;
}
