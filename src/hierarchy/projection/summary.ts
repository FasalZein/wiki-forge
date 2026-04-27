import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { projectRoot, requireValue, safeMatter } from "../../cli-shared";
import { readText } from "../../lib/fs";
import { collectStatusRow, collectVerifySummary, loadLintingSnapshot } from "../../verification";
import { collectDriftSummary } from "../../maintenance/drift/index";
import { collectBacklog, collectBacklogFocus } from "../backlog";
import { resolveDefaultBase } from "../../git-utils";
import { printJson, printLine } from "../../lib/cli-output";

export async function summaryProject(args: string[]) {
  const project = args.find((arg) => !arg.startsWith("--"));
  requireValue(project, "project");
  const json = args.includes("--json");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const result = await collectSummary(project, repo);
  if (json) {
    printJson(result);
  } else {
    printLine(`=== ${project} ===`);
    if (result.description) printLine(result.description);
    printLine(`repo: ${result.repo ?? "not set"}`);
    printLine(`base: ${result.base}`);
    printLine(`modules: ${result.status.modules} | pages: ${result.status.pages} | bound: ${result.status.bound} | unbound: ${result.status.unbound}`);
    printLine(`verification: ${Object.entries(result.verify.byLevel).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
    printLine(`drift: fresh=${result.drift.fresh} stale=${result.drift.stale} unknown=${result.drift.unknown}`);
    if (result.focus.activeTask) {
      printLine(`\nfocus:`);
      printLine(`  - active: ${result.focus.activeTask.id} ${result.focus.activeTask.title}`);
      if (result.focus.activeTask.hasSliceDocs) printLine(`    plan=${result.focus.activeTask.planStatus} test-plan=${result.focus.activeTask.testPlanStatus}`);
    } else if (result.focus.recommendedTask) {
      printLine(`\nfocus:`);
      printLine(`  - next: ${result.focus.recommendedTask.id} ${result.focus.recommendedTask.title}`);
    }
    if (result.activeWork.length) {
      printLine(`\nactive work:`);
      for (const item of result.activeWork) printLine(`  - ${item.id} ${item.title}`);
    }
    if (result.topTodo.length) {
      printLine(`\ntop todo:`);
      for (const item of result.topTodo) printLine(`  - ${item.id} ${item.title}`);
    }
    printLine(`\nnext steps:`);
    if (result.drift.stale) printLine(`  - ${result.drift.stale} stale page(s) need review: wiki drift-check ${project} --show-unbound`);
    if (result.status.unbound > 10) printLine(`  - ${result.status.unbound} unbound pages: wiki discover ${project} --tree`);
    if (!result.activeWork.length && result.topTodo.length) printLine(`  - no active work — pick a task from backlog`);
    printLine(`  - wiki maintain ${project} — for full maintenance queue`);
  }
}

async function collectSummary(project: string, explicitRepo?: string) {
  const root = projectRoot(project);
  const summaryPath = `${root}/_summary.md`;
  let description: string | undefined;
  let repoPath: string | undefined;
  try {
    const parsed = safeMatter(relative(VAULT_ROOT, summaryPath), await readText(summaryPath), { silent: true });
    if (parsed) {
      description = parsed.data.description ? String(parsed.data.description) : undefined;
      repoPath = parsed.data.repo ? String(parsed.data.repo) : undefined;
    }
  } catch {}
  const lintingSnapshot = await loadLintingSnapshot(project);
  const status = await collectStatusRow(project, lintingSnapshot);
  const verify = await collectVerifySummary(project, lintingSnapshot);
  let drift = { fresh: 0, stale: 0, unknown: 0, deleted: 0, renamed: 0 };
  try { const d = await collectDriftSummary(project, explicitRepo, lintingSnapshot); drift = { fresh: d.fresh, stale: d.stale, unknown: d.unknown, deleted: d.deleted, renamed: d.renamed }; } catch {}
  const backlog = await collectBacklog(project);
  const focus = await collectBacklogFocus(project, backlog);
  const activeWork = backlog.sections["In Progress"] ?? []; // desloppify:ignore EMPTY_ARRAY_FALLBACK
  const topTodo = (backlog.sections["Todo"] ?? []).slice(0, 5); // desloppify:ignore EMPTY_ARRAY_FALLBACK
  const base = await resolveDefaultBase(project, explicitRepo);
  return { project, description, repo: repoPath, base, status, verify, drift, activeWork, topTodo, focus };
}
