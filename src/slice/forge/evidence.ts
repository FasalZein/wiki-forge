import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { readFlagValue, readFlagValues } from "../../lib/cli-utils";
import { exists, readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { projectTaskHubPath } from "../../lib/structure";
import { printJson, printLine } from "../../lib/cli-output";
import { FORGE_PHASES, type ForgePhase } from "../../protocol/status/index";
import { defaultAgentName } from "../shared";

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

type EvidencePhase = Extract<ForgePhase, "tdd" | "verify">;

export type ForgeEvidenceArgs = {
  project: string;
  sliceId: string;
  phase: EvidencePhase;
  red: string[];
  green: string[];
  commands: string[];
  notes: string[];
  repo?: string;
  agent?: string;
  json: boolean;
};

export type RecordedForgeEvidence = {
  phase: EvidencePhase;
  completedAt: string;
  evidence: string[];
};

export function parseForgeEvidenceArgs(args: string[]): ForgeEvidenceArgs {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--red", "--green", "--command", "--note", "--repo", "--agent"].includes(arg)) {
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
  if (phase !== "tdd" && phase !== "verify") {
    throw new Error(`forge evidence currently records tdd or verify only; use existing planning commands for ${phase}`);
  }
  const red = readFlagValues(args, "--red").map((value) => value.trim()).filter(Boolean);
  const green = readFlagValues(args, "--green").map((value) => value.trim()).filter(Boolean);
  const commands = readFlagValues(args, "--command").map((value) => value.trim()).filter(Boolean);
  const notes = readFlagValues(args, "--note").map((value) => value.trim()).filter(Boolean);
  if (phase === "tdd" && red.length + green.length + commands.length + notes.length === 0) {
    throw new Error("tdd evidence requires at least one --red, --green, --command, or --note value");
  }
  if (phase === "verify" && commands.length === 0) {
    throw new Error("verify evidence requires at least one --command value");
  }
  const repo = readFlagValue(args, "--repo");
  const agent = readFlagValue(args, "--agent") ?? defaultAgentName();
  const json = args.includes("--json");
  return { project, sliceId, phase, red, green, commands, notes, repo, agent, json };
}

export async function recordForgeEvidence(input: Omit<ForgeEvidenceArgs, "json">): Promise<RecordedForgeEvidence> {
  const indexPath = projectTaskHubPath(input.project, input.sliceId);
  if (!(await exists(indexPath))) throw new Error(`slice index not found: ${input.sliceId}`);
  const matter = safeMatter(relative(VAULT_ROOT, indexPath), await readText(indexPath), { silent: true });
  if (!matter) throw new Error(`could not parse slice index: ${input.sliceId}`);

  const now = nowIso();
  const existingLedger = readEditableLedger(matter.data.forge_workflow_ledger);
  const phaseEvidence = input.phase === "tdd"
    ? buildTddEvidence(input)
    : buildVerifyEvidence(input);

  if (input.phase === "tdd") {
    const existing = readStringArray(readPhaseObject(existingLedger.tdd).tddEvidence);
    existingLedger.tdd = {
      ...readPhaseObject(existingLedger.tdd),
      completedAt: now,
      tddEvidence: mergeEvidence(existing, phaseEvidence),
    };
  } else {
    const existing = readStringArray(readPhaseObject(existingLedger.verify).verificationCommands);
    existingLedger.verify = {
      ...readPhaseObject(existingLedger.verify),
      completedAt: now,
      verificationCommands: mergeEvidence(existing, phaseEvidence),
    };
  }

  const nextData = orderFrontmatter(
    { ...matter.data, forge_workflow_ledger: existingLedger, updated: now },
    HUB_FRONTMATTER_ORDER,
  );
  writeNormalizedPage(indexPath, matter.content, nextData);
  appendLogEntry("forge-evidence", input.sliceId, {
    project: input.project,
    details: [
      `phase=${input.phase}`,
      `agent=${input.agent ?? "unknown"}`,
      ...phaseEvidence.map((entry) => `evidence=${entry}`),
    ],
  });
  return { phase: input.phase, completedAt: now, evidence: phaseEvidence };
}

export async function forgeEvidence(args: string[]): Promise<void> {
  const parsed = parseForgeEvidenceArgs(args);
  const recorded = await recordForgeEvidence(parsed);
  if (parsed.json) {
    printJson({ project: parsed.project, sliceId: parsed.sliceId, recorded });
  } else {
    printLine(`recorded ${parsed.phase} evidence for ${parsed.sliceId}`);
    for (const evidence of recorded.evidence) printLine(`- ${evidence}`);
  }
}

function buildTddEvidence(input: Pick<ForgeEvidenceArgs, "red" | "green" | "commands" | "notes">) {
  return [
    ...input.red.map((value) => `red: ${value}`),
    ...input.green.map((value) => `green: ${value}`),
    ...input.commands.map((value) => `command: ${value}`),
    ...input.notes.map((value) => `note: ${value}`),
  ];
}

function buildVerifyEvidence(input: Pick<ForgeEvidenceArgs, "commands">) {
  return input.commands;
}

function readEditableLedger(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

function readPhaseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function mergeEvidence(existing: string[], incoming: string[]) {
  return [...new Set([...existing, ...incoming])];
}
