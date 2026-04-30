import type { CommandHandler } from "../shared/contracts/command"; // desloppify:ignore *
import { printHelp } from "../cli-shared";
import { dependencyGraph } from "./project-views/dependency-graph";
import { featureStatusCommand } from "./project-views/feature-status";
import { updateIndex } from "./project-views/index-log";
import { createLayerPage, lintVault, scaffoldLayer } from "./project-views/layers";
import { summaryProject } from "./project-views/summary";
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
import { scaffoldResearch, researchStatus, ingestResearch, ingestSource, lintResearch, auditResearch, handoffResearch, bridgeResearch, distillResearch, adoptResearch } from "./research";
import { askProject, fileAnswer, fileResearch } from "./retrieval/answers";
import { qmdEmbed, qmdSetup, qmdStatus, qmdUpdate, queryVault, searchVault } from "./retrieval/qmd-commands";
import { forgeAmendCommand, forgeCheckCommand, forgeCloseCommand, forgeEvidenceCommand, forgeNextCommand, forgePlanCommand, forgeReleaseCommand, forgeReviewCommand, forgeRunCommand, forgeStartCommand, forgeStatusCommand } from "../forge/workflow/commands";
import { exportPromptCommand, handoverCommand, logCommand, noteCommand, resumeCommand } from "./memory/commands";
import { acknowledgeImpact } from "./verification/acknowledge-impact";
import { bindSourcePaths, migrateVerification, verifyPage } from "./verification/verification-pages";
import { cacheClear, lintProject, lintSemanticProject, verifyProject } from "./verification/linting";
import { configCommand } from "./config";
import { schemaCommand } from "./schema";

export const WIKI_COMMANDS: Record<string, CommandHandler> = {
  help: (args) => printHelp(args),
  "scaffold-project": (args) => scaffoldProject(args[0]),
  "create-module": (args) => createModule(args),
  onboard: (args) => onboardProject(args),
  "onboard-plan": (args) => onboardPlan(args),
  "normalize-module": (args) => normalizeModule(args),
  dashboard: (args) => dashboardProject(args),
  "commit-check": (args) => commitCheck(args),
  "install-git-hook": (args) => installGitHook(args),
  "refresh-on-merge": (args) => refreshOnMerge(args),
  checkpoint: (args) => checkpoint(args),
  "lint-repo": (args) => lintRepo(args),
  "protocol:sync": (args) => syncProtocol(args),
  "protocol:audit": (args) => auditProtocol(args),
  "dependency-graph": (args) => dependencyGraph(args),
  handover: (args) => handoverCommand(args),
  note: (args) => noteCommand(args),
  next: (args) => forgeNextCommand(args),
  "acknowledge-impact": (args) => acknowledgeImpact(args),
  "export-prompt": (args) => exportPromptCommand(args),
  resume: (args) => resumeCommand(args),
  doctor: (args) => doctorProject(args),
  maintain: (args) => maintainProject(args),
  refresh: (args) => refreshProject(args),
  "refresh-from-git": (args) => refreshFromGit(args),
  sync: (args) => syncProject(args),
  discover: (args) => discoverProject(args),
  "ingest-diff": (args) => ingestDiff(args),
  "update-index": (args) => updateIndex(args),
  log: (args) => logCommand(args),
  obsidian: (args) => obsidianCommand(args),
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
  "feature-status": (args) => featureStatusCommand(args),
  config: (args) => configCommand(args),
  schema: (args) => schemaCommand(args),
};

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
  if (command === "handover") return { command: "handover", args: rest };
  if (command === "resume") return { command: "resume", args: rest };
  if (command === "next") return { command: "next", args: rest };
  if (command === "export-prompt") return { command: "export-prompt", args: rest };
  if (command === "note") return { command: "note", args: rest };
  if (command === "log") return { command: "log", args: rest };
  return { command, args: rest };
}
