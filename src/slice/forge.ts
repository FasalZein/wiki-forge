import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { readVerificationLevel, resolveRepoPath } from "../lib/verification";
import { readFlagValue, defaultAgentName } from "../lib/cli-utils";
import { exists, readText } from "../lib/fs";
import { runPipeline } from "../lib/pipeline";
import { collectCloseout, collectGate } from "../maintenance";
import { type ForgeWorkflowLedger, validateForgeWorkflowLedger } from "../lib/forge-ledger";
import { applyDerivedLedger } from "../lib/forge-ledger-detect";
import { projectPrdsDir, projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath } from "../lib/structure";
import { collectBacklogFocus, collectBacklogView, collectTaskContextForId, detectTaskDocState, createFeatureReturningId, createPrdReturningId, moveTaskToSection } from "../hierarchy";
import { appendLogEntry } from "../lib/log";
import type { BacklogTaskContext } from "../hierarchy";
import { createIssueSlice } from "./slice-scaffold";
import { startSlice, startSliceCore } from "./start";
import { writeSliceProgress, type SlicePipelineProgress, type PipelineStepProgress } from "../lib/slice-progress";

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
  if (parsed.json) console.log(JSON.stringify(compactForgeStatusForJson(workflow), null, 2));
  else renderForgeStatus(workflow);
}

type ForgeMode = "start" | "check" | "close" | "status" | "run";

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
  const authoredLedger: Partial<ForgeWorkflowLedger> = {
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
  // PRD-056: merge artifact-detected ledger fields; authored fields win, derived fills gaps.
  // applyDerivedLedger is safe even if detection fails (degrades gracefully).
  let ledger: Partial<ForgeWorkflowLedger>;
  try {
    const { merged } = await applyDerivedLedger(authoredLedger, project, sliceId);
    ledger = merged;
  } catch {
    // Detection failure degrades gracefully — fall back to authored ledger
    ledger = authoredLedger;
  }
  const validation = validateForgeWorkflowLedger(ledger as ForgeWorkflowLedger);
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
      sliceStatus: context?.sliceStatus ?? null,
      section: context?.section ?? null,
      planStatus: context?.planStatus ?? "missing",
      testPlanStatus: context?.testPlanStatus ?? "missing",
      verificationLevel,
      nextPhase: validation.nextPhase ?? null,
    }),
  };
}

function buildForgeTriage(project: string, sliceId: string, input: { activeSlice: string | null; sliceStatus: string | null; section: string | null; planStatus: string; testPlanStatus: string; verificationLevel: string | null; nextPhase: string | null }) {
  const earlyPhase = input.planStatus !== "ready" || input.testPlanStatus !== "ready";
  if (earlyPhase && input.nextPhase === "research") {
    return {
      kind: "needs-research",
      reason: "workflow ledger shows research phase is incomplete",
      command: `/research — gather findings and file with wiki research file ${project}`,
    };
  }
  if (earlyPhase && input.nextPhase === "grill") {
    return {
      kind: "needs-grill",
      reason: "workflow ledger shows grill phase is incomplete",
      command: `/grill-me — stress-test the design and record decisions`,
    };
  }
  if (earlyPhase && input.nextPhase === "prd") {
    return {
      kind: "needs-prd",
      reason: "workflow ledger shows PRD phase is incomplete",
      command: `/write-a-prd — create or complete the PRD for this feature`,
    };
  }
  if (input.planStatus !== "ready" || input.testPlanStatus !== "ready") {
    return {
      kind: "fill-docs",
      reason: `plan=${input.planStatus} test-plan=${input.testPlanStatus}`,
      command: `update projects/${project}/specs/slices/${sliceId}/plan.md and test-plan.md`,
    };
  }
  if (input.sliceStatus === "done" || input.section === "Done") {
    return {
      kind: "completed",
      reason: "slice is done",
      command: `wiki forge next ${project}`,
    };
  }
  if (input.verificationLevel !== "test-verified") {
    return {
      kind: "close-slice",
      reason: `verification level is ${input.verificationLevel ?? "missing"}`,
      command: `wiki forge run ${project} ${sliceId} --repo <path>`,
    };
  }
  if (input.activeSlice === sliceId) {
    // Test-verified + active + not yet in Done section → close it via forge run.
    // The workflow ledger (research/grill/prd/...) is for the full feature chain;
    // a slice that passed verification should close, not go back to research.
    return {
      kind: "close-slice",
      reason: "slice is test-verified; close it",
      command: `wiki forge run ${project} ${sliceId} --repo <path>`,
    };
  }
  return {
    kind: "open-slice",
    reason: `slice ${sliceId} is not the active slice`,
    command: `wiki forge run ${project} ${sliceId} --repo <path>`,
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
    if (!step.ok) {
      if (step.stdout) {
        for (const line of step.stdout.split("\n")) console.log(`  ${line}`);
      }
      if (step.stderr && step.stderr !== step.error) {
        for (const line of step.stderr.split("\n")) console.log(`  stderr: ${line}`);
      } else if (step.error) {
        console.log(`  error: ${step.error}`);
      }
    }
  }
  if (review) {
    if (review.blockers.length) console.log(`- slice-local blockers: ${review.blockers.length}`);
    for (const finding of review.findings) {
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

function compactForgeStatusForJson(workflow: Awaited<ReturnType<typeof collectForgeStatus>>) {
  const { context, ...rest } = workflow;
  return {
    ...rest,
    context: context
      ? {
          id: context.id,
          title: context.title,
          section: context.section,
          assignee: context.assignee,
          sliceStatus: context.sliceStatus,
          planStatus: context.planStatus,
          testPlanStatus: context.testPlanStatus,
          dependencies: context.dependencies,
          blockedBy: context.blockedBy,
        }
      : null,
  };
}

export async function forgeOpen(args: string[]) {
  return forgeStart(args);
}

export async function forgeRelease(args: string[]) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");

  const context = await collectTaskContextForId(project, sliceId);
  if (!context) throw new Error(`slice not found in backlog: ${sliceId}`);

  const indexPath = projectTaskHubPath(project, sliceId);
  if (!await exists(indexPath)) throw new Error(`slice index not found: ${sliceId}`);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!parsed) throw new Error(`could not parse slice index: ${sliceId}`);

  const claimedBy = typeof parsed.data.claimed_by === "string" ? parsed.data.claimed_by.trim() : null;
  if (!claimedBy) {
    console.log(`no active claim on ${sliceId}`);
    return;
  }

  const wasStarted = context.section === "In Progress" || parsed.data.status === "in-progress";

  const data = { ...parsed.data };
  delete data.claimed_by;
  delete data.claimed_at;
  delete data.claim_paths;
  if (wasStarted) {
    delete data.started_at;
    data.status = "todo";
  }
  data.updated = nowIso();
  writeNormalizedPage(indexPath, parsed.content, orderFrontmatter(data, [
    "title", "type", "spec_kind", "project", "source_paths", "task_id",
    "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "started_at", "status",
  ]));

  if (wasStarted) {
    await moveTaskToSection(project, sliceId, "Todo");
  }

  appendLogEntry("release-claim", sliceId, { project, details: [`released_from=${claimedBy}`] });
  console.log(`released claim on ${sliceId} (was owned by ${claimedBy})`);
  if (wasStarted) console.log(`moved ${sliceId} back to Todo`);
}

export async function forgePlan(args: string[]) {
  const parsed = parseForgePlanArgs(args);
  let createdFeatureId: string | undefined;
  let createdPrdId: string | undefined;
  const createdSliceIds: string[] = [];
  let lastStep = "parse";
  try {
    lastStep = "create-feature";
    const featureId = parsed.featureId ?? await (async () => {
      requireValue(parsed.featureName, "feature-name (positional) or --feature FEAT-xxx");
      const { specId } = await createFeatureReturningId(parsed.project, parsed.featureName!);
      console.log(`created feature ${specId}`);
      createdFeatureId = specId;
      return specId;
    })();
    if (!createdFeatureId) createdFeatureId = featureId;
    const prdName = parsed.prdName ?? parsed.featureName;
    requireValue(prdName, "prd-name (--prd-name) or feature-name positional");
    lastStep = "create-prd";
    const { specId: prdId } = await createPrdReturningId(parsed.project, prdName!, featureId);
    console.log(`created prd ${prdId}`);
    createdPrdId = prdId;

    if (parsed.slices.length > 0) {
      // Multi-slice path
      for (let i = 0; i < parsed.slices.length; i += 1) {
        const sliceTitle = parsed.slices[i];
        lastStep = `create-slice-${i + 1}`;
        const sliceArgs = [
          parsed.project,
          sliceTitle,
          "--prd", prdId,
          ...(parsed.agent ? ["--assignee", parsed.agent] : []),
        ];
        const slice = await createIssueSlice(sliceArgs);
        if (!slice) throw new Error(`createIssueSlice did not return a result for slice ${i + 1}`);
        console.log(`created slice ${slice.taskId}`);
        createdSliceIds.push(slice.taskId);

        if (i > 0) {
          const previousSliceId = createdSliceIds[i - 1];
          await patchSliceDependsOn(parsed.project, slice.taskId, previousSliceId);
        }

        if (i === 0) {
          lastStep = "start-slice";
          await startSlice([
            parsed.project,
            slice.taskId,
            ...(parsed.agent ? ["--agent", parsed.agent] : []),
            ...(parsed.repo ? ["--repo", parsed.repo] : []),
          ]);
        }

        lastStep = `autofill-docs-${i + 1}`;
        await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
      }
      const [startedId, ...pendingIds] = createdSliceIds;
      const pendingSummary = pendingIds.length ? `; pending: ${pendingIds.join(", ")}` : "";
      console.log(`started ${startedId}${pendingSummary}`);
    } else {
      // Single-slice path (original behavior)
      lastStep = "create-slice";
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
      createdSliceIds.push(slice.taskId);
      lastStep = "start-slice";
      await startSlice([
        parsed.project,
        slice.taskId,
        ...(parsed.agent ? ["--agent", parsed.agent] : []),
        ...(parsed.repo ? ["--repo", parsed.repo] : []),
      ]);
      lastStep = "autofill-docs";
      await autoFillSliceDocs(parsed.project, slice.taskId, prdId);
    }
  } catch (error) {
    const artifacts: string[] = [];
    if (createdFeatureId) artifacts.push(`  feature: ${createdFeatureId}`);
    if (createdPrdId) artifacts.push(`  prd: ${createdPrdId}`);
    for (const sliceId of createdSliceIds) artifacts.push(`  slice: ${sliceId}`);
    if (artifacts.length) {
      console.error(`forge plan failed at ${lastStep}. Already created:\n${artifacts.join("\n")}`);
      if (createdSliceIds.length) console.error(`Use: wiki forge start ${parsed.project} ${createdSliceIds[0]} to retry from start-slice`);
    }
    throw error;
  }
}

async function patchSliceDependsOn(project: string, sliceId: string, dependsOnSliceId: string): Promise<void> {
  const indexPath = projectTaskHubPath(project, sliceId);
  const raw = await readText(indexPath);
  const parsed = safeMatter(relative(VAULT_ROOT, indexPath), raw, { silent: true });
  if (!parsed) return;
  const updatedData = orderFrontmatter(
    { ...parsed.data, depends_on: [dependsOnSliceId], updated: nowIso() },
    ["title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id", "depends_on", "parent_prd", "parent_feature", "created_at", "updated", "status"],
  );
  writeNormalizedPage(indexPath, parsed.content, updatedData);
}

type ForgePlanArgs = {
  project: string;
  featureName: string | undefined;
  featureId: string | undefined;
  prdName: string | undefined;
  title: string | undefined;
  slices: string[];
  agent: string | undefined;
  repo: string | undefined;
};

function parseForgePlanArgs(args: string[]): ForgePlanArgs {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let prdName: string | undefined;
  let title: string | undefined;
  let slices: string[] = [];
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
      case "--slices": {
        const raw = args[index + 1] ?? "";
        slices = raw.split(",").map((s) => s.trim()).filter(Boolean);
        index += 1;
        break;
      }
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
  return { project, featureName, featureId, prdName, title, slices, agent, repo };
}

export async function forgeNext(args: string[]) {
  const positional = args.filter((a) => !a.startsWith("--"));
  const project = positional[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const promptFlag = args.includes("--prompt");
  const promptJson = args.includes("--prompt-json");
  const all = args.includes("--all");

  if (all && !promptJson) {
    throw new Error("--all requires --prompt-json");
  }

  if (all && promptJson) {
    await forgeNextAll(project);
    return;
  }

  const focus = await collectBacklogFocus(project);

  const activeId = focus.activeTask?.id ?? null;
  // Only recommend a slice if its hub (index.md) exists on disk; unscaffolded slices cannot be started
  const recommendedId = (focus.recommendedTask?.taskHubPath !== undefined ? focus.recommendedTask?.id : null) ?? null;
  const targetId = activeId ?? recommendedId;

  if (!targetId) {
    if (json || promptJson) console.log(JSON.stringify({ project, targetSlice: null, action: "no ready slices" }, null, 2));
    else console.log(`no ready slices for ${project}`);
    return;
  }

  const workflow = await collectForgeStatus(project, targetId);

  if (promptJson || promptFlag) {
    const promptData = await buildSlicePromptData(project, targetId, workflow, activeId !== null);
    if (promptJson) {
      console.log(JSON.stringify(promptData, null, 2));
    } else {
      console.log(renderSlicePrompt(promptData));
    }
    return;
  }

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

type SlicePromptData = {
  sliceId: string;
  project: string;
  title: string;
  repo: string;
  planPath: string;
  testPlanPath: string;
  planSummary: string;
  testPlanSummary: string;
  commands: string[];
};

async function buildSlicePromptData(
  project: string,
  sliceId: string,
  workflow: Awaited<ReturnType<typeof collectForgeStatus>>,
  active: boolean,
): Promise<SlicePromptData> {
  const title = typeof workflow.context?.title === "string" ? workflow.context.title : sliceId;
  const planPath = projectTaskPlanPath(project, sliceId);
  const testPlanPath = projectTaskTestPlanPath(project, sliceId);
  const [planDoc, testPlanDoc, repo] = await Promise.all([
    readMatter(planPath),
    readMatter(testPlanPath),
    resolveRepoPath(project).catch(() => "<repo-path>"),
  ]);
  const planSummary = compactDocSummary(planDoc?.content ?? "", ["Scope", "Acceptance Criteria"]);
  const testPlanSummary = compactDocSummary(testPlanDoc?.content ?? "", ["Red Tests", "Verification Commands"]);
  const commands: string[] = [
    `wiki forge ${active ? "run" : "start"} ${project} ${sliceId} --repo ${repo}`,
  ];
  return { sliceId, project, title, repo, planPath, testPlanPath, planSummary, testPlanSummary, commands };
}

function renderSlicePrompt(data: SlicePromptData): string {
  const lines: string[] = [
    `Implement slice ${data.sliceId} for project ${data.project}.`,
    "",
    `Repo: ${data.repo}`,
    `Slice: ${data.sliceId} — ${data.title}`,
    `Plan: ${data.planSummary ? data.planSummary.split("\n")[0] : "(no plan summary)"}`,
    `Test Plan: ${data.testPlanSummary ? data.testPlanSummary.split("\n")[0] : "(no test plan summary)"}`,
    "",
    "Steps:",
    `1. Read the full plan at ${data.planPath}`,
    `2. Read the test plan at ${data.testPlanPath}`,
    "3. Implement using /tdd",
    ...data.commands.map((cmd, i) => `${i + 4}. Run: ${cmd}`),
  ];
  return lines.join("\n");
}

async function forgeNextAll(project: string): Promise<void> {
  const view = await collectBacklogView(project);
  // Include both In Progress (active) and unblocked Todo slices that have a scaffolded hub (index.md)
  const inProgressTasks = ((view.sections["In Progress"] ?? []) as BacklogTaskContext[]).filter((task) => task.taskHubPath !== undefined);
  const todoTasks = ((view.sections["Todo"] ?? []) as BacklogTaskContext[]).filter((task) => task.taskHubPath !== undefined && task.blockedBy.length === 0);

  const inProgressEntries = inProgressTasks.map((task) => ({ task, active: true }));
  const todoEntries = todoTasks.map((task) => ({ task, active: false }));
  const candidates = [...inProgressEntries, ...todoEntries];

  if (!candidates.length) {
    console.log(JSON.stringify([], null, 2));
    return;
  }

  const results = await Promise.all(
    candidates.map(async ({ task, active }) => {
      const workflow = await collectForgeStatus(project, task.id);
      return buildSlicePromptData(project, task.id, workflow, active);
    }),
  );
  console.log(JSON.stringify(results, null, 2));
}

function extractSectionFuzzy(markdown: string, keyword: string): string {
  // Try all headings where the text contains the keyword (case-insensitive)
  const pattern = new RegExp(`^##[^#].*${escapeRegex(keyword)}.*\\n([\\s\\S]*?)(?=^##\\s|$)`, "imu");
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function compactDocSummary(content: string, sections: string[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    // First try exact match
    let extracted = extractSection(content, section).trim();
    // Fall back to case-insensitive partial match on any heading containing the keyword
    if (!extracted) extracted = extractSectionFuzzy(content, section).trim();
    if (!extracted) continue;
    const sectionLines = extracted.split("\n").filter((l) => l.trim()).slice(0, 5);
    lines.push(`${section}: ${sectionLines.join(" | ")}`);
  }
  if (lines.length > 0) return lines.join("\n");
  // Last resort: extract first 3 non-empty, non-heading, non-list-marker-only lines from body
  const bodyLines = content
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !/^#{1,6}\s/u.test(t) && !/^-\s*(?:\[[ x]\])?\s*$/u.test(t);
    })
    .slice(0, 3);
  return bodyLines.length > 0 ? bodyLines.join(" | ") : "(empty)";
}

async function autoFillSliceDocs(project: string, sliceId: string, prdId: string): Promise<void> {
  const prdDoc = await readPlanningDoc(projectPrdsDir(project), prdId);
  if (!prdDoc) {
    console.warn(`[warn] PRD ${prdId} not found; skipping auto-fill for ${sliceId}`);
    return;
  }

  const goals = extractSection(prdDoc.content, "Goals");
  const userStories = extractSection(prdDoc.content, "User Stories");
  const acceptance = extractSection(prdDoc.content, "Acceptance Criteria");
  const problem = extractSection(prdDoc.content, "Problem");

  const prdTitle = typeof prdDoc.data.title === "string" ? prdDoc.data.title.trim() : prdId;

  // Build scope summary from PRD problem + title
  const scopeBody = problem.trim()
    ? `- ${prdTitle}: ${problem.split("\n").find((line) => line.trim()) ?? problem.trim()}`
    : `- ${prdTitle}`;

  // Build acceptance criteria from PRD acceptance criteria, then user stories, then goals as fallback
  let criteriaLines: string[] = [];
  if (acceptance.trim()) {
    criteriaLines = acceptance.split("\n").filter((line) => line.trim());
  } else if (userStories.trim()) {
    criteriaLines = userStories
      .split("\n")
      .filter((line) => /^-\s+/u.test(line.trim()))
      .map((line) => `- [ ] ${line.replace(/^-\s*/u, "").trim()}`);
  } else if (goals.trim()) {
    criteriaLines = goals
      .split("\n")
      .filter((line) => /^-\s+/u.test(line.trim()))
      .map((line) => `- [ ] ${line.replace(/^-\s*/u, "").trim()}`);
  }

  if (!criteriaLines.length) criteriaLines = [`- [ ] implement requirements from ${prdTitle}`];

  // Build vertical slice steps from acceptance criteria count
  const stepCount = Math.min(Math.max(criteriaLines.length, 3), 5);
  const verticalSliceLines = Array.from({ length: stepCount }, (_, i) => `${i + 1}. (fill in during TDD)`);

  // Build red test placeholders from acceptance criteria
  const redTestLines = criteriaLines.map((line) => {
    const text = line.replace(/^-\s*\[[ x]\]\s*/u, "").replace(/^-\s*/u, "").trim();
    return `- [ ] ${text}`;
  });

  await fillPlanDoc(project, sliceId, scopeBody, verticalSliceLines, criteriaLines);
  await fillTestPlanDoc(project, sliceId, redTestLines);
}

async function fillPlanDoc(project: string, sliceId: string, scopeBody: string, verticalSliceLines: string[], criteriaLines: string[]): Promise<void> {
  const planPath = projectTaskPlanPath(project, sliceId);
  const raw = await readText(planPath);
  const parsed = safeMatter(relative(VAULT_ROOT, planPath), raw, { silent: true });
  if (!parsed) return;

  let content = parsed.content;
  content = replaceSection(content, "Scope", scopeBody);
  content = replaceSection(content, "Vertical Slice", verticalSliceLines.join("\n"));
  content = replaceSection(content, "Acceptance Criteria", criteriaLines.join("\n"));

  const updatedData = { ...parsed.data, status: "ready", updated: nowIso() };
  writeNormalizedPage(planPath, content, updatedData);
}

async function fillTestPlanDoc(project: string, sliceId: string, redTestLines: string[]): Promise<void> {
  const testPlanPath = projectTaskTestPlanPath(project, sliceId);
  const raw = await readText(testPlanPath);
  const parsed = safeMatter(relative(VAULT_ROOT, testPlanPath), raw, { silent: true });
  if (!parsed) return;

  let content = parsed.content;
  content = replaceSection(content, "Red Tests", redTestLines.join("\n"));
  content = replaceSection(content, "Green Criteria", "- [ ] All red tests pass\n- [ ] No regressions in existing test suite");
  content = replaceSection(content, "Refactor Checks", "- [ ] confirm no regressions in adjacent code paths");
  content = replaceSection(content, "Verification Commands", "```bash\nbun test\nnpx tsc --noEmit\n```");

  const updatedData = { ...parsed.data, status: "ready", updated: nowIso() };
  writeNormalizedPage(testPlanPath, content, updatedData);
}

function replaceSection(markdown: string, heading: string, newBody: string): string {
  // Split on ## headings, replace the matching section body, then rejoin.
  const headingMarker = `## ${heading}`;
  const sectionStart = markdown.indexOf(`\n${headingMarker}\n`);
  if (sectionStart === -1) return markdown;

  const bodyStart = sectionStart + headingMarker.length + 2; // skip \n## Heading\n
  // Find the next ## heading after bodyStart
  const nextHeading = markdown.indexOf("\n## ", bodyStart);
  const bodyEnd = nextHeading === -1 ? markdown.length : nextHeading;

  return (
    markdown.slice(0, bodyStart) +
    `${newBody.trim()}\n\n` +
    markdown.slice(bodyEnd)
  );
}

function classifyStepFailure(stepId: string, error: string | null): string {
  if (!error) return "Check pipeline output for details";
  switch (stepId) {
    case "checkpoint": return "Update stale wiki pages related to this slice";
    case "lint-repo": return "Move disallowed repo markdown files to wiki vault";
    case "maintain": return "Run wiki maintain manually for diagnostics";
    case "verify-slice": return `Fix failing verification commands: ${error}`;
    case "closeout": return "Update impacted wiki pages and re-verify";
    case "gate": return "Add tests for changed code files or add test_exemptions";
    case "close-slice": return error;
    default: return error;
  }
}

export async function forgeRun(args: string[]) {
  const parsed = await parseForgeArgs(args, "run");

  const context = await collectTaskContextForId(parsed.project, parsed.sliceId);
  if (!context || context.section !== "In Progress") {
    const startResult = await startSliceCore(parsed.project, parsed.sliceId, defaultAgentName(), parsed.repo);
    if (!startResult.ok) {
      const errorPayload = {
        ok: false,
        step: "auto-start",
        error: startResult.error ?? "start failed",
        status: startResult.status,
        ...(startResult.conflicts?.length ? { conflicts: startResult.conflicts } : {}),
        ...(startResult.blocking?.length ? { blocking: startResult.blocking } : {}),
      };
      if (parsed.json) console.log(JSON.stringify(errorPayload, null, 2));
      throw new Error(`forge run: auto-start failed: ${startResult.error}`);
    }
    if (!parsed.json) console.log(`auto-started ${parsed.sliceId} (agent: ${startResult.agent})`);
  }

  const workflow = await collectForgeStatus(parsed.project, parsed.sliceId);

  const progressSteps: PipelineStepProgress[] = [];
  const onStepComplete = async (step: { id: string; label: string; ok: boolean; error: string | null; durationMs: number | null }) => {
    progressSteps.push({
      id: step.id,
      ok: step.ok,
      completedAt: new Date().toISOString(),
      durationMs: step.durationMs,
      ...(step.error ? { error: step.error } : {}),
    });
  };

  const writeProgress = async (pipelineOk: boolean, nextAction?: string, failureSummary?: string) => {
    const progress: SlicePipelineProgress = {
      steps: progressSteps,
      lastStep: progressSteps[progressSteps.length - 1]?.id ?? "none",
      lastStepOk: progressSteps[progressSteps.length - 1]?.ok ?? false,
      pipelineOk,
      lastRunAt: new Date().toISOString(),
      ...(nextAction ? { nextAction } : {}),
      ...(failureSummary ? { failureSummary } : {}),
    };
    await writeSliceProgress(parsed.project, parsed.sliceId, progress);
  };

  const checkResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "close",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
    onStepComplete,
  });
  const review = parsed.dryRun
    ? null
    : await collectForgeReview(parsed.project, parsed.sliceId, parsed.repo, parsed.base, parsed.worktree);
  if (!parsed.json) renderForgePipeline("check", workflow, checkResult, review);
  if (!checkResult.ok) {
    const failedStep = checkResult.stoppedAt ?? "unknown";
    const failedStepError = checkResult.steps.find((s) => s.id === failedStep)?.error ?? null;
    const nextAction = classifyStepFailure(failedStep, failedStepError);
    await writeProgress(false, nextAction, `check failed at ${failedStep}`);
    throw new Error(`forge run: check failed at ${failedStep}`);
  }
  if (review && !review.ok) {
    await writeProgress(false, "Resolve slice-local blockers reported by forge check", "check found slice-local blockers");
    throw new Error("forge run: check found slice-local blockers");
  }

  const closeResult = await runPipeline({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: "verify",
    repo: parsed.repo,
    base: parsed.base,
    dryRun: parsed.dryRun,
    worktree: parsed.worktree,
    sliceLocal: true,
    onStepComplete,
  });
  if (parsed.json) console.log(JSON.stringify({ ...workflow, check: checkResult, close: closeResult }, null, 2));
  else renderForgePipeline("close", workflow, closeResult);
  if (!closeResult.ok) {
    const failedStep = closeResult.stoppedAt ?? "unknown";
    const failedStepError = closeResult.steps.find((s) => s.id === failedStep)?.error ?? null;
    const nextAction = classifyStepFailure(failedStep, failedStepError);
    await writeProgress(false, nextAction, `close failed at ${failedStep}`);
    throw new Error(`forge run: close failed at ${failedStep}`);
  }

  await writeProgress(true);
}

