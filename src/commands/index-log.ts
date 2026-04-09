import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, projectRoot, requireValue, safeMatter } from "../cli-shared";
import { tailLog, appendLogEntry } from "../lib/log";
import { walkMarkdown } from "../lib/vault";

export function updateIndex(args: string[]) {
  const json = args.includes("--json");
  const write = args.includes("--write");
  const all = args.includes("--all");
  const project = all ? undefined : args.find((arg) => !arg.startsWith("--"));
  if (!all) requireValue(project, "project or --all");
  const result = buildIndexPlan(project, all);
  if (write) applyIndexPlan(result);
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

function buildIndexPlan(project: string | undefined, all: boolean) {
  const targets: Array<{ path: string; content: string }> = [];
  if (all) {
    const projectsRoot = join(VAULT_ROOT, "projects");
    const projects = existsSync(projectsRoot) ? readdirSync(projectsRoot).filter((entry) => statSync(join(projectsRoot, entry)).isDirectory()).sort() : [];
    const lines = ["# Index", "", "## Projects", ""];
    for (const name of projects) {
      const summaryPath = join(projectRoot(name), "_summary.md");
      const title = existsSync(summaryPath) ? readPageTitle(summaryPath) : name;
      lines.push(`- [[projects/${name}/_summary|${title}]]`);
    }
    lines.push("");
    targets.push({ path: "index.md", content: `${lines.join("\n")}\n` });
    for (const name of projects) targets.push(buildProjectIndexTarget(name));
    return { all, project: null, targets };
  }
  targets.push(buildProjectIndexTarget(project!));
  return { all, project: project!, targets };
}

function applyIndexPlan(plan: { targets: Array<{ path: string; content: string }> }) {
  for (const target of plan.targets) {
    const absolutePath = join(VAULT_ROOT, target.path);
    mkdirIfMissing(dirname(absolutePath));
    writeFileSync(absolutePath, target.content, "utf8");
  }
}

function buildProjectIndexTarget(project: string) {
  const root = projectRoot(project);
  const pages = walkMarkdown(root).sort();
  const sections = new Map<string, string[]>();
  for (const file of pages) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const section = rel.includes("/") ? rel.split("/")[0] : "root";
    const vaultPath = relative(VAULT_ROOT, file).replace(/\.md$/u, "").replaceAll("\\", "/");
    const lines = sections.get(section) ?? [];
    lines.push(`- [[${vaultPath}|${readPageTitle(file)}]]`);
    sections.set(section, lines);
  }
  const out = [`# ${project} Index`, "", `- [[projects/${project}/_summary|${project} summary]]`, ""];
  for (const [section, lines] of [...sections.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${section}`, "", ...lines.sort(), "");
  }
  return { path: `projects/${project}/specs/index.md`, content: `${out.join("\n")}\n` };
}

function readPageTitle(file: string) {
  const parsed = safeMatter(relative(VAULT_ROOT, file), readFileSync(file, "utf8"), { silent: true });
  const title = parsed?.data.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const heading = parsed?.content.split("\n").find((line) => line.startsWith("# "));
  return heading?.replace(/^#\s+/u, "").trim() || relative(VAULT_ROOT, file).replace(/\.md$/u, "");
}
