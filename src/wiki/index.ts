import type { CommandHandler } from "../types"; // desloppify:ignore *
import { printHelp } from "../cli-shared";
import { dependencyGraph } from "../hierarchy/dependency-graph";
import { featureStatusCommand } from "../hierarchy/feature-status";
import { updateIndex } from "../hierarchy/index-log";
import { createLayerPage, lintVault, scaffoldLayer } from "../hierarchy/layers";
import { summaryProject } from "../hierarchy/summary";
import { checkpoint } from "../maintenance/checkpoint";
import { commitCheck, installGitHook } from "../maintenance/commit-check";
import { dashboardProject } from "../maintenance/dashboard";
import { discoverProject, ingestDiff } from "../maintenance/discover";
import { doctorProject } from "../maintenance/doctor";
import { driftCheck } from "../maintenance/drift";
import { lintRepo } from "../maintenance/lint-repo";
import { maintainProject } from "../maintenance/maintain";
import { refreshFromGit, refreshOnMerge, refreshProject } from "../maintenance/refresh";
import { syncProject } from "../maintenance/sync";
import { scaffoldProject, onboardProject, onboardPlan, createModule, normalizeModule, syncProtocol, auditProtocol, obsidianCommand, setupShell } from "../protocol";
import { scaffoldResearch, researchStatus, ingestResearch, ingestSource, lintResearch, auditResearch, handoffResearch, bridgeResearch, distillResearch, adoptResearch } from "../research";
import { askProject, fileAnswer, fileResearch } from "../retrieval/answers";
import { qmdEmbed, qmdSetup, qmdStatus, qmdUpdate, queryVault, searchVault } from "../retrieval/qmd-commands";
import { forgeAmendCommand, forgeCheckCommand, forgeCloseCommand, forgeEvidenceCommand, forgeNextCommand, forgePlanCommand, forgeReleaseCommand, forgeReviewCommand, forgeRunCommand, forgeStartCommand, forgeStatusCommand } from "../forge/workflow/commands";
import { exportPromptCommand, handoverCommand, logCommand, noteCommand, resumeCommand } from "./memory/commands";
import { acknowledgeImpact } from "../verification/acknowledge-impact";
import { bindSourcePaths, migrateVerification, verifyPage } from "../verification/verification-pages";
import { cacheClear, lintProject, lintSemanticProject, verifyProject } from "../verification/linting";
import { configCommand } from "../config";
import { schemaCommand } from "../schema";
import { assertCommandNotQuarantined } from "./runtime/command-surface";
import { compatibilityCommand } from "./runtime/compat";

export const WIKI_COMMANDS: Record<string, CommandHandler> = {
  help: (args) => printHelp(args),
  "scaffold-project": (args) => scaffoldProject(args[0]),
  backlog: quarantinedCommand("backlog"),
  "add-task": quarantinedCommand("add-task"),
  "move-task": quarantinedCommand("move-task"),
  "complete-task": quarantinedCommand("complete-task"),
  "create-issue-slice": quarantinedCommand("create-issue-slice"),
  "create-feature": quarantinedCommand("create-feature"),
  "create-prd": quarantinedCommand("create-prd"),
  "create-plan": quarantinedCommand("create-plan"),
  "create-test-plan": quarantinedCommand("create-test-plan"),
  "create-module": (args) => createModule(args),
  onboard: (args) => onboardProject(args),
  "onboard-plan": (args) => onboardPlan(args),
  "normalize-module": (args) => normalizeModule(args),
  dashboard: (args) => dashboardProject(args),
  closeout: quarantinedCommand("closeout"),
  "commit-check": (args) => commitCheck(args),
  "install-git-hook": (args) => installGitHook(args),
  "refresh-on-merge": (args) => refreshOnMerge(args),
  checkpoint: (args) => checkpoint(args),
  "lint-repo": (args) => lintRepo(args),
  "protocol:sync": (args) => syncProtocol(args),
  "protocol:audit": (args) => auditProtocol(args),
  "dependency-graph": (args) => dependencyGraph(args),
  handover: (args) => handoverCommand(args),
  claim: quarantinedCommand("claim"),
  note: (args) => noteCommand(args),
  next: (args) => forgeNextCommand(args),
  "start-slice": quarantinedCommand("start-slice"),
  "verify-slice": quarantinedCommand("verify-slice"),
  "close-slice": quarantinedCommand("close-slice"),
  "acknowledge-impact": (args) => acknowledgeImpact(args),
  "export-prompt": (args) => exportPromptCommand(args),
  resume: (args) => resumeCommand(args),
  doctor: (args) => doctorProject(args),
  gate: quarantinedCommand("gate"),
  maintain: (args) => maintainProject(args),
  refresh: (args) => refreshProject(args),
  "refresh-from-git": (args) => refreshFromGit(args),
  sync: (args) => syncProject(args),
  discover: (args) => discoverProject(args),
  "ingest-diff": (args) => ingestDiff(args),
  "update-index": (args) => updateIndex(args),
  log: (args) => logCommand(args),
  obsidian: (args) => obsidianCommand(args),
  status: quarantinedCommand("status"),
  lint: (args) => lintProject(args),
  "lint-semantic": (args) => lintSemanticProject(args),
  verify: (args) => verifyProject(args),
  search: (args) => searchVault(args),
  query: (args) => queryVault(args),
  ask: (args) => askProject(args),
  "file-answer": (args) => fileAnswer(args),
  "research:scaffold": (args) => scaffoldResearch(args),
  "research:status": (args) => researchStatus(args),
  "research:ingest": (args) => ingestResearch(args),
  "research:file": (args) => fileResearch(args),
  "research:lint": (args) => lintResearch(args),
  "research:audit": (args) => auditResearch(args),
  "research:handoff": (args) => handoffResearch(args),
  "research:bridge": (args) => bridgeResearch(args),
  "research:distill": (args) => distillResearch(args),
  "research:adopt": (args) => adoptResearch(args),
  "source:ingest": (args) => ingestSource(args),
  "qmd-status": () => qmdStatus(),
  "qmd-update": (args) => qmdUpdate(args),
  "qmd-embed": () => qmdEmbed(),
  "qmd-setup": () => qmdSetup(),
  bind: (args) => bindSourcePaths(args),
  "drift-check": (args) => driftCheck(args),
  "verify-page": (args) => verifyPage(args),
  "migrate-verification": (args) => migrateVerification(args[0]),
  "cache-clear": () => cacheClear(),
  summary: (args) => summaryProject(args),
  "setup-shell": (args) => setupShell(args),
  "scaffold-layer": (args) => scaffoldLayer(args),
  "create-layer-page": (args) => createLayerPage(args),
  "lint-vault": (args) => lintVault(args),
  pipeline: quarantinedCommand("pipeline"),
  "pipeline-reset": quarantinedCommand("pipeline-reset"),
  "feature-status": (args) => featureStatusCommand(args),
  "start-feature": quarantinedCommand("start-feature"),
  "close-feature": quarantinedCommand("close-feature"),
  "start-prd": quarantinedCommand("start-prd"),
  "close-prd": quarantinedCommand("close-prd"),
  config: (args) => configCommand(args),
  schema: (args) => schemaCommand(args),
  "v1:forge:next": (args) => forgeNextCommand(args),
  "v1:forge:status": (args) => forgeStatusCommand(args),
  "v1:forge:plan": (args) => forgePlanCommand(args),
  "v1:forge:start": (args) => forgeStartCommand(args),
  "v1:forge:release": (args) => forgeReleaseCommand(args),
  "v1:forge:amend": (args) => forgeAmendCommand(args),
  "v1:forge:check": (args) => forgeCheckCommand(args),
  "v1:forge:close": (args) => forgeCloseCommand(args),
  "v1:forge:run": (args) => forgeRunCommand(args),
  "v1:forge:evidence": (args) => forgeEvidenceCommand(args),
  "v1:forge:review": (args) => forgeReviewCommand(args),
  "v1:handover": (args) => handoverCommand(args),
  "v1:resume": (args) => resumeCommand(args),
  "v1:export-prompt": (args) => exportPromptCommand(args),
  "v1:note": (args) => noteCommand(args),
  "v1:log": (args) => logCommand(args),
  "v1:compat": (args) => compatibilityCommand(args),
};

function quarantinedCommand(command: string): CommandHandler {
  return async () => { assertCommandNotQuarantined(command); };
}

export function resolveWikiCommand(rawArgs: string[]) {
  const [rawCommand = "help", ...rest] = rawArgs;
  const command = rawCommand === "--help" || rawCommand === "-h" ? "help" : rawCommand;
  if (command === "research") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand || subcommand === "help") throw new Error("missing research subcommand. Run 'wiki help' for usage.");
    const mapped = {
      scaffold: "research:scaffold",
      status: "research:status",
      ingest: "research:ingest",
      lint: "research:lint",
      audit: "research:audit",
      file: "research:file",
      handoff: "research:handoff",
      bridge: "research:bridge",
      distill: "research:distill",
      adopt: "research:adopt",
    }[subcommand as "scaffold" | "status" | "ingest" | "lint" | "audit" | "file" | "handoff" | "bridge" | "distill" | "adopt"];
    if (!mapped) throw new Error(`unknown research subcommand: ${subcommand}. Run 'wiki help' for usage.`);
    return { command: mapped, args: subArgs };
  }
  if (command === "source") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand || subcommand === "help") throw new Error("missing source subcommand. Run 'wiki help' for usage.");
    const mapped = {
      ingest: "source:ingest",
    }[subcommand as "ingest"];
    if (!mapped) throw new Error(`unknown source subcommand: ${subcommand}. Run 'wiki help' for usage.`);
    return { command: mapped, args: subArgs };
  }
  if (command === "protocol") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand || subcommand === "help") throw new Error("missing protocol subcommand. Run 'wiki help' for usage.");
    const mapped = {
      sync: "protocol:sync",
      audit: "protocol:audit",
    }[subcommand as "sync" | "audit"];
    if (!mapped) throw new Error(`unknown protocol subcommand: ${subcommand}. Run 'wiki help' for usage.`);
    return { command: mapped, args: subArgs };
  }
  assertCommandNotQuarantined(command);
  if (command === "handover") return { command: "v1:handover", args: rest };
  if (command === "resume") return { command: "v1:resume", args: rest };
  if (command === "next") return { command: "v1:forge:next", args: rest };
  if (command === "export-prompt") return { command: "v1:export-prompt", args: rest };
  if (command === "note") return { command: "v1:note", args: rest };
  if (command === "log") return { command: "v1:log", args: rest };
  if (command === "v1") {
    return resolveV1Command(rest);
  }
  return { command, args: rest };
}

function resolveV1Command(rawArgs: string[]) {
  const [area, subcommand, ...subArgs] = rawArgs;
  if (!area || area === "help") throw new Error("missing v1 subcommand. Run 'wiki help' for usage.");
  if (area === "forge") {
    if (subcommand === "next") return { command: "v1:forge:next", args: subArgs };
    if (subcommand === "status") return { command: "v1:forge:status", args: subArgs };
    if (subcommand === "plan") return { command: "v1:forge:plan", args: subArgs };
    if (subcommand === "start") return { command: "v1:forge:start", args: subArgs };
    if (subcommand === "release") return { command: "v1:forge:release", args: subArgs };
    if (subcommand === "amend") return { command: "v1:forge:amend", args: subArgs };
    if (subcommand === "check") return { command: "v1:forge:check", args: subArgs };
    if (subcommand === "close") return { command: "v1:forge:close", args: subArgs };
    if (subcommand === "run") return { command: "v1:forge:run", args: subArgs };
    if (subcommand === "evidence") return { command: "v1:forge:evidence", args: subArgs };
    if (subcommand === "review") return { command: "v1:forge:review", args: subArgs };
    throw new Error(`unknown v1 forge subcommand: ${subcommand ?? ""}. Run 'wiki help' for usage.`);
  }
  if (area === "resume") {
    return { command: "v1:resume", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  if (area === "handover") {
    return { command: "v1:handover", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  if (area === "export-prompt") {
    return { command: "v1:export-prompt", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  if (area === "note") {
    return { command: "v1:note", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  if (area === "log") {
    return { command: "v1:log", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  if (area === "compat") {
    return { command: "v1:compat", args: [subcommand, ...subArgs].filter((arg): arg is string => Boolean(arg)) };
  }
  throw new Error(`unknown v1 subcommand: ${area}. Run 'wiki help' for usage.`);
}
