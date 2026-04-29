import { renderSteeringPacket, type ForgeSteeringPacket, type ForgeTriage } from "../../protocol/steering/index";
import { collectForgeStatus } from "../../protocol";
import { printLine } from "../../lib/cli-output";
import { formatDiagnosticFindingLines, type DiagnosticFinding } from "../../maintenance/shared";

type RenderableDiagnosticFinding = Pick<DiagnosticFinding, "message" | "files" | "details" | "repair">;

export type ResolvedForgeWorkflow = Awaited<ReturnType<typeof collectForgeStatus>> & {
  triage: ForgeTriage;
  steering: ForgeSteeringPacket;
};

export type ForgeStatusWithoutSlice = {
  project: string;
  sliceId: null;
  activeSlice: string | null;
  recommendedSlice: string | null;
  triage: ForgeTriage;
  steering: ForgeSteeringPacket;
};

export function renderForgeStatus(workflow: ResolvedForgeWorkflow) {
  printLine(`forge status for ${workflow.project}/${workflow.sliceId}`);
  for (const line of renderSteeringPacket(workflow.steering)) printLine(`- ${line}`);
  printLine(`- active slice: ${workflow.activeSlice ?? "none"}`);
  printLine(`- recommended slice: ${workflow.recommendedSlice ?? "none"}`);
  printGitTruthLine(workflow.gitTruth);
  printLine(`- parent prd: ${workflow.parentPrd ?? "none"}`);
  printLine(`- parent feature: ${workflow.parentFeature ?? "none"}`);
  printLine(`- plan: ${workflow.planStatus}`);
  printLine(`- test-plan: ${workflow.testPlanStatus}`);
  printLine(`- verification level: ${workflow.verificationLevel ?? "none"}`);
  printLine(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  const nextPhaseStatus = workflow.workflow.validation.statuses.find((status) => status.phase === workflow.workflow.validation.nextPhase);
  if (nextPhaseStatus?.missing.length) {
    printLine(`  unmet: ${nextPhaseStatus.missing.join(", ")}`);
  }
  printLine(`- next action: ${workflow.triage.command}`);
  printLine(`  reason: ${workflow.triage.reason}`);
  for (const status of workflow.workflow.validation.statuses) {
    let state = `blocked by ${status.blockedBy.join(", ")}`;
    if (status.completed) state = "done";
    else if (status.ready) state = "ready";
    printLine(`  - ${status.phase}: ${state}${status.missing.length ? ` | unmet ${status.missing.join(", ")}` : ""}`);
  }
}

export function renderForgeStatusWithoutSlice(status: ForgeStatusWithoutSlice) {
  printLine(`forge status for ${status.project}`);
  for (const line of renderSteeringPacket(status.steering)) printLine(`- ${line}`);
  printLine(`- active slice: ${status.activeSlice ?? "none"}`);
  printLine(`- recommended slice: ${status.recommendedSlice ?? "none"}`);
  printLine(`- next action: ${status.triage.command}`);
  printLine(`  reason: ${status.triage.reason}`);
}

function printGitTruthLine(gitTruth: unknown) {
  if (!gitTruth || typeof gitTruth !== "object") return;
  const truth = gitTruth as Record<string, unknown>;
  if (truth.unavailable === true) {
    printLine(`- git worktree: unavailable (${String(truth.error ?? "unknown error")})`);
    return;
  }
  if (truth.clean === true) {
    printLine(`- git worktree: CLEAN`);
    return;
  }
  const counts = truth.counts && typeof truth.counts === "object" ? truth.counts as Record<string, unknown> : {};
  const parts = ["staged", "unstaged", "untracked", "deleted", "renamed"]
    .map((key) => [key, Number(counts[key] ?? 0)] as const)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${key}`);
  printLine(`- git worktree: DIRTY (${parts.join(", ") || "changed files"})`);
}

function printDiagnosticFinding(prefix: string, finding: RenderableDiagnosticFinding) {
  const [firstLine = finding.message, ...detailLines] = formatDiagnosticFindingLines(finding);
  printLine(`${prefix} ${firstLine}`);
  for (const line of detailLines) printLine(`  ${line}`);
}

export function applyResolvedSteering(
  workflow: Awaited<ReturnType<typeof collectForgeStatus>>,
  triage: ForgeTriage,
  steering: ForgeSteeringPacket,
): ResolvedForgeWorkflow {
  return {
    ...workflow,
    triage,
    steering,
  };
}
