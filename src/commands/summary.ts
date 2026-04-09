import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { projectRoot, requireValue, safeMatter } from "../cli-shared";
import { collectStatusRow, collectVerifySummary } from "./linting";
import { collectDriftSummary } from "./verification";
import { collectBacklog } from "./backlog";
import { resolveDefaultBase } from "./maintenance";

export async function summaryProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const result = await collectSummary(project, repo);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`=== ${project} ===`);
    if (result.description) console.log(result.description);
    console.log(`repo: ${result.repo ?? "not set"}`);
    console.log(`base: ${result.base}`);
    console.log(`modules: ${result.status.modules} | pages: ${result.status.pages} | bound: ${result.status.bound} | unbound: ${result.status.unbound}`);
    console.log(`verification: ${Object.entries(result.verify.byLevel).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
    console.log(`drift: fresh=${result.drift.fresh} stale=${result.drift.stale} unknown=${result.drift.unknown}`);
    if (result.activeWork.length) {
      console.log(`\nactive work:`);
      for (const item of result.activeWork) console.log(`  - ${item.id} ${item.title}`);
    }
    if (result.topTodo.length) {
      console.log(`\ntop todo:`);
      for (const item of result.topTodo) console.log(`  - ${item.id} ${item.title}`);
    }
    console.log(`\nnext steps:`);
    if (result.drift.stale) console.log(`  - ${result.drift.stale} stale page(s) need review: wiki drift-check ${project} --show-unbound`);
    if (result.status.unbound > 10) console.log(`  - ${result.status.unbound} unbound pages: wiki discover ${project} --tree`);
    if (!result.activeWork.length && result.topTodo.length) console.log(`  - no active work — pick a task from backlog`);
    console.log(`  - wiki maintain ${project} — for full maintenance queue`);
  }
}

async function collectSummary(project: string, explicitRepo?: string) {
  const root = projectRoot(project);
  const summaryPath = `${root}/_summary.md`;
  let description: string | undefined;
  let repoPath: string | undefined;
  try {
    const parsed = safeMatter(relative(VAULT_ROOT, summaryPath), readFileSync(summaryPath, "utf8"), { silent: true });
    if (parsed) {
      description = parsed.data.description ? String(parsed.data.description) : undefined;
      repoPath = parsed.data.repo ? String(parsed.data.repo) : undefined;
    }
  } catch {}
  const status = await collectStatusRow(project);
  const verify = await collectVerifySummary(project);
  let drift = { fresh: 0, stale: 0, unknown: 0, deleted: 0, renamed: 0 };
  try { const d = collectDriftSummary(project, explicitRepo); drift = { fresh: d.fresh, stale: d.stale, unknown: d.unknown, deleted: d.deleted, renamed: d.renamed }; } catch {}
  const backlog = collectBacklog(project);
  const activeWork = backlog.sections["In Progress"] ?? [];
  const topTodo = (backlog.sections["Todo"] ?? []).slice(0, 5);
  const base = resolveDefaultBase(project, explicitRepo);
  return { project, description, repo: repoPath, base, status, verify, drift, activeWork, topTodo };
}
