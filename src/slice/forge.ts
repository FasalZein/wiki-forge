import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { requireValue, safeMatter } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { readVerificationLevel } from "../lib/verification";
import { exists, readText } from "../lib/fs";
import { runPipeline } from "../lib/pipeline";
import { collectCloseout, collectGate } from "../maintenance";
import { type ForgeWorkflowLedger, validateForgeWorkflowLedger } from "../lib/forge-ledger";
import { projectPrdsDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "../lib/structure";
import { collectBacklogFocus, collectTaskContextForId, detectTaskDocState, createFeatureReturningId, createPrdReturningId } from "../hierarchy";
import { createIssueSlice } from "./slice-scaffold";
import { startSlice } from "./coordination";

export async function forgeStart(args: string[]) {
  const parsed = await parseForgeArgs(args, "start");
  return startSlice([parsed.project, parsed.sliceId, ...parsed.passthrough]);
}

export async function forgeCheck(args: string[]) {
  const parsed = await parseForgeArgs(args, "check");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId);
  const result = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "close",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
  });
  const review = parsed.dryRun
    ? null
    : await collectForgeReview(parsed.project, parsed.sliceId, parsed.repo, parsed.base, parsed.worktree);
  if (parsed.json) console.log(JSON.stringify({ ...workflow, pipeline: result, ...(review ? { review } : {}) }, null, 2));
  else renderForgePipeline("check", workflow, result, review);
  if (!result.ok) throw new Error(`forge check failed at ${result.stoppedAt}`);
  if (review && !review.ok) throw new Error("forge check found slice-local blockers");
}

export async function forgeClose(args: string[]) {
  const parsed = await parseForgeArgs(args, "close");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId);
  const result = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "verify",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
  });
  if (parsed.json) console.log(JSON.stringify({ ...workflow, pipeline: result }, null, 2));
  else renderForgePipeline("close", workflow, result);
  if (!result.ok) throw new Error(`forge close failed at ${result.stoppedAt}`);
}

export async function forgeStatus(args: string[]) {
  const parsed = await parseForgeArgs(args, "status");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId);
  if (parsed.json) console.log(JSON.stringify(workflow, null, 2));
  else renderForgeStatus(workflow);
}

type ForgeMode = "start" | "check" | "close" | "status";

type ParsedForgeArgs = {
  project: string;
  sliceId: string;
  passthrough: string[];
  repo?: string;
  base?: string;
  json: boolean;
  dryRun: boolean;
  worktree: boolean;
};

async function parseForgeArgs(args: string[], mode: ForgeMode): Promise<ParsedForgeArgs> {
  const { positional, passthrough } = splitForgeArgs(args);
  const project = positional[0];
  requireValue(project, "project");
  const explicitSliceId = positional[1];
  const sliceId = await resolveForgeSliceId(project, explicitSliceId, mode);
  const repo = readFlagValue(passthrough, "--repo");
  const base = readFlagValue(passthrough, "--base");
  const json = passthrough.includes("--json");
  const dryRun = passthrough.includes("--dry-run");
  const worktree = passthrough.includes("--worktree") || (!base && mode !== "start");
  return { project, sliceId, passthrough, repo, base, json, dryRun, worktree };
}

function splitForgeArgs(args: string[]) {
  const positional: string[] = [];
  const passthrough: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      passthrough.push(arg);
      if (flagTakesValue(arg) && index + 1 < args.length) {
        passthrough.push(args[index + 1]);
        index += 1;
      }
      continue;
    }
    if (positional.length < 2) positional.push(arg);
    else passthrough.push(arg);
  }
  return { positional, passthrough };
}

function flagTakesValue(flag: string) {
  return flag === "--agent" || flag === "--repo" || flag === "--base";
}

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function resolveForgeSliceId(project: string, explicitSliceId: string | undefined, mode: ForgeMode) {
  if (explicitSliceId) return explicitSliceId;
  const focus = await collectBacklogFocus(project);
  const candidate = mode === "start"
    ? focus.recommendedTask?.id ?? focus.activeTask?.id
    : focus.activeTask?.id ?? focus.recommendedTask?.id;
  requireValue(candidate, "slice-id");
  return candidate;
}

export async function collectForgeStatus(project: string, sliceId: string) {
  const [focus, context, hub, plan, testPlan, decisionRefs] = await Promise.all([
    collectBacklogFocus(project),
    collectTaskContextForId(project, sliceId),
    readMatter(projectTaskHubPath(project, sliceId)),
    readMatter(projectTaskPlanPath(project, sliceId)),
    readMatter(projectTaskTestPlanPath(project, sliceId)),
    collectDecisionRefs(project),
  ]);
  const parentPrd = typeof hub?.data.parent_prd === "string" ? hub.data.parent_prd : undefined;
  const parentFeature = typeof hub?.data.parent_feature === "string" ? hub.data.parent_feature : undefined;
  const prdDoc = parentPrd ? await readPlanningDoc(projectPrdsDir(project), parentPrd) : null;
  const researchRefs = prdDoc ? extractWikilinks(extractSection(prdDoc.content, "Prior Research")) : [];
  const verificationCommands = Array.isArray(testPlan?.data.verification_commands)
    ? testPlan.data.verification_commands
      .map((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).command === "string" ? String((entry as Record<string, unknown>).command) : null)
      .filter((value): value is string => Boolean(value))
    : [];
  const tddReady = await detectTaskDocState(projectTaskTestPlanPath(project, sliceId)) === "ready" && Boolean(testPlan?.content.includes("## Red Tests"));
  const ledger: ForgeWorkflowLedger = {
    project,
    sliceId,
    ...(parentPrd ? { parentPrd } : {}),
    ...(researchRefs.length ? { research: { completedAt: readUpdated(prdDoc?.data), researchRefs } } : {}),
    ...(decisionRefs.length ? { grill: { completedAt: decisionRefs[0].completedAt, decisionRefs: decisionRefs.map((entry) => entry.ref) } } : {}),
    ...(prdDoc && parentPrd ? { prd: { completedAt: readUpdated(prdDoc.data), prdRef: parentPrd, parentPrd } } : {}),
    ...(hub && plan && testPlan ? { slices: { completedAt: readUpdated(hub.data), sliceRefs: [sliceId] } } : {}),
    ...(tddReady ? { tdd: { completedAt: readUpdated(testPlan?.data), tddEvidence: [`projects/${project}/specs/slices/${sliceId}/test-plan.md#red-tests`] } } : {}),
    ...(verificationCommands.length ? { verify: { completedAt: readUpdated(testPlan?.data), verificationCommands } } : {}),
  };
  const validation = validateForgeWorkflowLedger(ledger);
  const verificationLevel = testPlan ? readVerificationLevel(testPlan.data) : null;
  return {
    project,
    sliceId,
    activeSlice: focus.activeTask?.id ?? null,
    recommendedSlice: focus.recommendedTask?.id ?? null,
    context,
    parentPrd: parentPrd ?? null,
    parentFeature: parentFeature ?? null,
    planStatus: context?.planStatus ?? "missing",
    testPlanStatus: context?.testPlanStatus ?? "missing",
    verificationLevel,
    workflow: {
      ledger,
      validation,
    },
    triage: buildForgeTriage(project, sliceId, {
      activeSlice: focus.activeTask?.id ?? null,
      planStatus: context?.planStatus ?? "missing",
      testPlanStatus: context?.testPlanStatus ?? "missing",
      verificationLevel,
      nextPhase: validation.nextPhase ?? null,
    }),
  };
}

function buildForgeTriage(project: string, sliceId: string, input: { activeSlice: string | null; planStatus: string; testPlanStatus: string; verificationLevel: string | null; nextPhase: string | null }) {
  if (input.planStatus !== "ready" || input.testPlanStatus !== "ready") {
    return {
      kind: "fill-docs",
      reason: `plan=${input.planStatus} test-plan=${input.testPlanStatus}`,
      command: `update projects/${project}/specs/slices/${sliceId}/plan.md and test-plan.md`,
    };
  }
  if (input.verificationLevel !== "test-verified") {
    return {
      kind: "close-slice",
      reason: `verification level is ${input.verificationLevel ?? "missing"}`,
      command: `wiki forge close ${project} ${sliceId} --repo <path>`,
    };
  }
  if (input.activeSlice === sliceId) {
    return {
      kind: "review-parents",
      reason: input.nextPhase ? `workflow next phase is ${input.nextPhase}` : "slice is verified; inspect parent/project follow-up",
      command: `wiki feature-status ${project}`,
    };
  }
  return {
    kind: "open-slice",
    reason: `slice ${sliceId} is not the active slice`,
    command: `wiki forge start ${project} ${sliceId} --repo <path>`,
  };
}

type MatterDoc = { path: string; data: Record<string, unknown>; content: string };

async function readMatter(path: string): Promise<MatterDoc | null> {
  if (!await exists(path)) return null;
  const raw = await readText(path);
  const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
  if (!parsed) return null;
  return { path, data: parsed.data, content: parsed.content };
}

async function readPlanningDoc(dir: string, id: string): Promise<MatterDoc | null> {
  if (!await exists(dir)) return null;
  const file = readdirSync(dir).find((entry) => entry.startsWith(`${id}-`) && entry.endsWith(".md"));
  return file ? readMatter(join(dir, file)) : null;
}

async function collectDecisionRefs(project: string) {
  const decisionsPath = join(VAULT_ROOT, "projects", project, "decisions.md");
  const decisions = await readMatter(decisionsPath);
  if (!decisions) return [] as Array<{ ref: string; completedAt: string }>;
  const body = extractSection(decisions.content, "Current Decisions");
  const hasEntries = body.split("\n").some((line) => /^-\s+/u.test(line.trim()));
  return hasEntries ? [{ ref: `projects/${project}/decisions.md#current-decisions`, completedAt: readUpdated(decisions.data) }] : [];
}

function extractSection(markdown: string, heading: string) {
  const match = markdown.match(new RegExp(`^## ${escapeRegex(heading)}\\n([\\s\\S]*?)(?=^##\\s|$)`, "mu"));
  return match?.[1]?.trim() ?? "";
}

function extractWikilinks(markdown: string) {
  return [...markdown.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readUpdated(data: Record<string, unknown> | undefined) {
  const value = data?.updated ?? data?.started_at ?? data?.created_at;
  return typeof value === "string" && value.trim() ? value : new Date(0).toISOString();
}

async function collectForgeReview(project: string, sliceId: string, repo: string | undefined, base: string | undefined, worktree: boolean) {
  const resolvedBase = base ?? "HEAD";
  const closeout = await collectCloseout(project, resolvedBase, repo, undefined, undefined, { worktree, sliceLocal: true, sliceId });
  const gate = await collectGate(project, resolvedBase, repo, { worktree, sliceLocal: true, sliceId, precomputedCloseout: closeout });
  return {
    ok: gate.ok,
    findings: gate.findings,
    blockers: gate.blockers,
    warnings: gate.warnings,
  };
}

function renderForgePipeline(action: "check" | "close", workflow: Awaited<ReturnType<typeof collectForgeStatus>>, result: Awaited<ReturnType<typeof runPipeline>>, review?: Awaited<ReturnType<typeof collectForgeReview>> | null) {
  console.log(`forge ${action} ${workflow.project}/${workflow.sliceId}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`- active slice: ${workflow.activeSlice ?? "none"}`);
  console.log(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  console.log(`- next action: ${workflow.triage.command}`);
  for (const step of result.steps) {
    let status = "FAILED";
    if (step.skipped) status = "skipped";
    else if (step.ok) status = "ok";
    const duration = step.durationMs !== null ? ` (${step.durationMs}ms)` : "";
    console.log(`- ${step.id}: ${status}${duration}`);
    if (step.error) console.log(`  error: ${step.error}`);
  }
  if (review) {
    if (review.blockers.length) console.log(`- slice-local blockers: ${review.blockers.length}`);
    for (const finding of review.findings.filter((finding) => finding.scope !== "slice" || finding.severity !== "blocker")) {
      console.log(`- [${finding.scope}][${finding.severity}] ${finding.message}`);
    }
  }
}

function renderForgeStatus(workflow: Awaited<ReturnType<typeof collectForgeStatus>>) {
  console.log(`forge status for ${workflow.project}/${workflow.sliceId}`);
  console.log(`- active slice: ${workflow.activeSlice ?? "none"}`);
  console.log(`- recommended slice: ${workflow.recommendedSlice ?? "none"}`);
  console.log(`- parent prd: ${workflow.parentPrd ?? "none"}`);
  console.log(`- parent feature: ${workflow.parentFeature ?? "none"}`);
  console.log(`- plan: ${workflow.planStatus}`);
  console.log(`- test-plan: ${workflow.testPlanStatus}`);
  console.log(`- verification level: ${workflow.verificationLevel ?? "none"}`);
  console.log(`- workflow next phase: ${workflow.workflow.validation.nextPhase ?? "complete"}`);
  console.log(`- next action: ${workflow.triage.command}`);
  console.log(`  reason: ${workflow.triage.reason}`);
  for (const status of workflow.workflow.validation.statuses) {
    let state = `blocked by ${status.blockedBy.join(", ")}`;
    if (status.completed) state = "done";
    else if (status.ready) state = "ready";
    console.log(`  - ${status.phase}: ${state}${status.missing.length ? ` | missing ${status.missing.join(", ")}` : ""}`);
  }
}

export async function forgeOpen(args: string[]) {
  return forgeStart(args);
}

export async function forgePlan(args: string[]) {
  const parsed = parseForgePlanArgs(args);
  const featureId = parsed.featureId ?? await (async () => {
    requireValue(parsed.featureName, "feature-name (positional) or --feature FEAT-xxx");
    const { specId } = await createFeatureReturningId(parsed.project, parsed.featureName!);
    console.log(`created feature ${specId}`);
    return specId;
  })();
  const prdName = parsed.prdName ?? parsed.featureName;
  requireValue(prdName, "prd-name (--prd-name) or feature-name positional");
  const { specId: prdId } = await createPrdReturningId(parsed.project, prdName!, featureId);
  console.log(`created prd ${prdId}`);
  const sliceTitle = parsed.title ?? prdName!;
  const sliceArgs = [
    parsed.project,
    sliceTitle,
    "--prd", prdId,
    ...(parsed.agent ? ["--assignee", parsed.agent] : []),
  ];
  const slice = await createIssueSlice(sliceArgs);
  if (!slice) throw new Error("createIssueSlice did not return a result");
  console.log(`created slice ${slice.taskId}`);
  await startSlice([
    parsed.project,
    slice.taskId,
    ...(parsed.agent ? ["--agent", parsed.agent] : []),
    ...(parsed.repo ? ["--repo", parsed.repo] : []),
  ]);
}

type ForgePlanArgs = {
  project: string;
  featureName: string | undefined;
  featureId: string | undefined;
  prdName: string | undefined;
  title: string | undefined;
  agent: string | undefined;
  repo: string | undefined;
};

function parseForgePlanArgs(args: string[]): ForgePlanArgs {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let prdName: string | undefined;
  let title: string | undefined;
  let agent: string | undefined;
  let repo: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--feature":
        featureId = args[index + 1];
        index += 1;
        break;
      case "--prd-name":
        prdName = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1];
        index += 1;
        break;
      default:
        if (!arg.startsWith("--")) nameParts.push(arg);
        break;
    }
  }
  const featureName = nameParts.join(" ").trim() || undefined;
  if (!featureId && !featureName) throw new Error("feature-name (positional) or --feature FEAT-xxx is required");
  return { project, featureName, featureId, prdName, title, agent, repo };
}

export async function forgeNext(args: string[]) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const focus = await collectBacklogFocus(project);

  const activeId = focus.activeTask?.id ?? null;
  const recommendedId = focus.recommendedTask?.id ?? null;
  const targetId = activeId ?? recommendedId;

  if (!targetId) {
    if (json) console.log(JSON.stringify({ project, targetSlice: null, action: "no ready slices" }, null, 2));
    else console.log(`no ready slices for ${project}`);
    return;
  }

  const workflow = await collectForgeStatus(project, targetId);
  const result = {
    project,
    targetSlice: targetId,
    active: activeId !== null,
    triage: workflow.triage,
    planStatus: workflow.planStatus,
    testPlanStatus: workflow.testPlanStatus,
    verificationLevel: workflow.verificationLevel,
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`forge next for ${project}: ${targetId}`);
    console.log(`- ${activeId ? "active" : "recommended"} slice`);
    console.log(`- plan: ${workflow.planStatus}`);
    console.log(`- test-plan: ${workflow.testPlanStatus}`);
    console.log(`- verification: ${workflow.verificationLevel ?? "none"}`);
    console.log(`- next action: ${workflow.triage.command}`);
    console.log(`  reason: ${workflow.triage.reason}`);
  }
}

export async function forgeRun(args: string[]) {
  const parsed = await parseForgeArgs(args, "check");
  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId);
  const checkResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "close",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
  });
  const review = parsed.dryRun
    ? null
    : await collectForgeReview(parsed.project, parsed.sliceId, parsed.repo, parsed.base, parsed.worktree);
  if (!parsed.json) renderForgePipeline("check", workflow, checkResult, review);
  if (!checkResult.ok) throw new Error(`forge run: check failed at ${checkResult.stoppedAt}`);
  if (review && !review.ok) throw new Error("forge run: check found slice-local blockers");

  const closeResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "verify",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
  });
  if (parsed.json) console.log(JSON.stringify({ ...workflow, check: checkResult, close: closeResult }, null, 2));
  else renderForgePipeline("close", workflow, closeResult);
  if (!closeResult.ok) throw new Error(`forge run: close failed at ${closeResult.stoppedAt}`);
}

