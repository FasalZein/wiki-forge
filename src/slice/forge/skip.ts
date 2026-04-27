import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { readFlagValue } from "../../lib/cli-utils";
import { exists, readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { projectTaskHubPath } from "../../lib/structure";
import { collectForgeStatus } from "../../protocol";
import {
  FORGE_PHASES,
  SKIPPABLE_FORGE_PHASES,
  isForgePhaseSkippable,
  type ForgePhase,
  type SkippableForgePhase,
  type SkippedPhaseRecord,
} from "../../protocol/status/index";
import { defaultAgentName } from "../shared";
import { printJson, printLine } from "../../lib/cli-output";

const HUB_FRONTMATTER_ORDER = [
  "title",
  "type",
  "spec_kind",
  "project",
  "source_paths",
  "assignee",
  "task_id",
  "depends_on",
  "parent_prd",
  "parent_feature",
  "claimed_by",
  "claimed_at",
  "claim_paths",
  "created_at",
  "updated",
  "started_at",
  "completed_at",
  "status",
  "verification_level",
  "workflow_profile",
  "forge_workflow_ledger",
];

export type ForgeSkipArgs = {
  project: string;
  sliceId: string;
  phase: ForgePhase;
  reason: string;
  repo?: string;
  agent?: string;
  json: boolean;
};

export function parseForgeSkipArgs(args: string[]): ForgeSkipArgs {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--reason" || arg === "--repo" || arg === "--agent") {
      index += 1;
      continue;
    }
    if (arg === "--json") continue;
    if (!arg.startsWith("--")) positional.push(arg);
  }
  const project = positional[0];
  const sliceId = positional[1];
  const phase = positional[2];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  requireValue(phase, "phase");
  if (!(FORGE_PHASES as readonly string[]).includes(phase)) {
    throw new Error(`unknown phase: ${phase}. Valid phases: ${FORGE_PHASES.join(", ")}`);
  }
  const reason = (readFlagValue(args, "--reason") ?? "").trim();
  if (!reason) throw new Error("--reason is required and must be non-empty");
  const repo = readFlagValue(args, "--repo");
  const agent = readFlagValue(args, "--agent") ?? defaultAgentName();
  const json = args.includes("--json");
  return { project, sliceId, phase: phase as ForgePhase, reason, repo, agent, json };
}

export type ForgeSkipInput = {
  project: string;
  sliceId: string;
  phase: ForgePhase;
  reason: string;
  repo?: string;
  agent?: string;
};

export async function recordForgeSkip(input: ForgeSkipInput): Promise<SkippedPhaseRecord> {
  if (!isForgePhaseSkippable(input.phase)) {
    throw new Error(
      `phase "${input.phase}" is not skippable. The skippable floor is: ${SKIPPABLE_FORGE_PHASES.join(", ")}. ` +
        `tdd and verify cannot be waived by a reason string.`,
    );
  }

  const status = await collectForgeStatus(input.project, input.sliceId, input.repo);
  const phaseStatus = status.workflow.validation.statuses.find((entry) => entry.phase === input.phase);
  const ledgerSkipped = (status.workflow.ledger.skippedPhases ?? []).some((entry) => entry.phase === input.phase); // desloppify:ignore EMPTY_ARRAY_FALLBACK
  if (!ledgerSkipped && phaseStatus?.completed) {
    throw new Error(`cannot skip ${input.phase} for ${input.sliceId}: phase is already completed`);
  }

  const indexPath = projectTaskHubPath(input.project, input.sliceId);
  if (!(await exists(indexPath))) throw new Error(`slice index not found: ${input.sliceId}`);
  const matter = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!matter) throw new Error(`could not parse slice index: ${input.sliceId}`);

  const now = nowIso();
  const record: SkippedPhaseRecord = {
    phase: input.phase as SkippableForgePhase,
    reason: input.reason,
    skippedAt: now,
    ...(input.agent ? { skippedBy: input.agent } : {}),
  };

  const existingLedger =
    matter.data.forge_workflow_ledger && typeof matter.data.forge_workflow_ledger === "object"
      ? { ...(matter.data.forge_workflow_ledger as Record<string, unknown>) }
      : {};
  const existingSkips = Array.isArray(existingLedger.skippedPhases)
    ? (existingLedger.skippedPhases as unknown[])
    : [];
  const filtered = existingSkips.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ph = (entry as Record<string, unknown>).phase;
    return typeof ph === "string" && ph !== input.phase;
  });
  existingLedger.skippedPhases = [...filtered, record];

  const nextData = orderFrontmatter(
    { ...matter.data, forge_workflow_ledger: existingLedger, updated: now },
    HUB_FRONTMATTER_ORDER,
  );
  writeNormalizedPage(indexPath, matter.content, nextData);
  appendLogEntry("forge-skip-phase", input.sliceId, {
    project: input.project,
    details: [`phase=${input.phase}`, `reason=${input.reason}`, `agent=${input.agent ?? "unknown"}`],
  });
  return record;
}

export async function forgeSkip(args: string[]): Promise<void> {
  const parsed = parseForgeSkipArgs(args);
  const record = await recordForgeSkip({
    project: parsed.project,
    sliceId: parsed.sliceId,
    phase: parsed.phase,
    reason: parsed.reason,
    repo: parsed.repo,
    agent: parsed.agent,
  });
  if (parsed.json) {
    printJson({ project: parsed.project, sliceId: parsed.sliceId, skipped: record });
  } else {
    printLine(`skipped ${parsed.phase} on ${parsed.sliceId}: ${parsed.reason}`);
  }
}
