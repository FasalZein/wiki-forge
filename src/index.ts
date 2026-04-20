#!/usr/bin/env bun

import type { CommandHandler } from "./types";
import { printHelp } from "./cli-shared";
import { backlogCommand, addTask, moveTask, completeTask, createFeature, createPrd, createPlan, createTestPlan, dependencyGraph, updateIndex, featureStatusCommand, startFeature, closeFeature, startPrd, closePrd, summaryProject, createLayerPage, lintVault, scaffoldLayer } from "./hierarchy";
import { dashboardProject, maintainProject, closeoutProject, refreshProject, refreshFromGit, syncProject, discoverProject, ingestDiff, commitCheck, installGitHook, refreshOnMerge, checkpoint, lintRepo, doctorProject, gateProject, driftCheck } from "./maintenance";
import { scaffoldProject, onboardProject, onboardPlan, createModule, normalizeModule, syncProtocol, auditProtocol, obsidianCommand, setupShell } from "./protocol";
import { scaffoldResearch, researchStatus, ingestResearch, ingestSource, lintResearch, auditResearch, distillResearch, adoptResearch } from "./research";
import { askProject, fileAnswer, fileResearch } from "./retrieval/answers";
import { qmdEmbed, qmdSetup, qmdStatus, qmdUpdate, queryVault, searchVault } from "./retrieval/qmd-commands";
import { handoverProject, resumeProject, nextProject, noteProject, exportPrompt, logCommand } from "./session";
import { claimSlice, startSlice, verifySlice, closeSlice, createIssueSlice, repairHistoricalDoneSlices } from "./slice";
import { forgeCheck, forgeClose, forgeNext, forgeOpen, forgePlan, forgeRelease, forgeRun, forgeStart, forgeStatus } from "./slice/forge";
import { pipelineCommand, pipelineResetCommand } from "./slice/pipeline";
import { statusProject, lintProject, lintSemanticProject, verifyProject, cacheClear, bindSourcePaths, migrateVerification, verifyPage, acknowledgeImpact } from "./verification";
import { configCommand } from "./config";
import { schemaCommand } from "./schema";
import { findProjectArg } from "./git-utils";
import { appendActivity, extractProject, extractTarget, resolveAgent, resolveSessionId } from "./lib/tracker";

const commands: Record<string, CommandHandler> = {
  help: () => printHelp(),
  "scaffold-project": (args) => scaffoldProject(args[0]),
  backlog: (args) => backlogCommand(args),
  "add-task": (args) => addTask(args),
  "move-task": (args) => moveTask(args),
  "complete-task": (args) => completeTask(args),
  "create-issue-slice": async (args) => { await createIssueSlice(args); },
  "create-feature": (args) => createFeature(args),
  "create-prd": (args) => createPrd(args),
  "create-plan": (args) => createPlan(args),
  "create-test-plan": (args) => createTestPlan(args),
  "create-module": (args) => createModule(args),
  onboard: (args) => onboardProject(args),
  "onboard-plan": (args) => onboardPlan(args),
  "normalize-module": (args) => normalizeModule(args),
  dashboard: (args) => dashboardProject(args),
  closeout: (args) => closeoutProject(args),
  "commit-check": (args) => commitCheck(args),
  "install-git-hook": (args) => installGitHook(args),
  "refresh-on-merge": (args) => refreshOnMerge(args),
  checkpoint: (args) => checkpoint(args),
  "lint-repo": (args) => lintRepo(args),
  "protocol:sync": (args) => syncProtocol(args),
  "protocol:audit": (args) => auditProtocol(args),
  "dependency-graph": (args) => dependencyGraph(args),
  handover: (args) => handoverProject(args),
  claim: (args) => claimSlice(args),
  note: (args) => noteProject(args),
  next: (args) => nextProject(args),
  "start-slice": (args) => startSlice(args),
  "verify-slice": (args) => verifySlice(args),
  "close-slice": (args) => closeSlice(args),
  "acknowledge-impact": (args) => acknowledgeImpact(args),
  "export-prompt": (args) => exportPrompt(args),
  resume: (args) => resumeProject(args),
  doctor: (args) => doctorProject(args),
  gate: (args) => gateProject(args),
  maintain: async (args) => {
    const project = findProjectArg(args);
    const repair = project ? await repairHistoricalDoneSlices(project) : undefined;
    await maintainProject(args, repair);
  },
  refresh: (args) => refreshProject(args),
  "refresh-from-git": (args) => refreshFromGit(args),
  sync: (args) => syncProject(args),
  discover: (args) => discoverProject(args),
  "ingest-diff": (args) => ingestDiff(args),
  "update-index": (args) => updateIndex(args),
  log: (args) => logCommand(args),
  obsidian: (args) => obsidianCommand(args),
  status: (args) => statusProject(args),
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
  pipeline: (args) => pipelineCommand(args),
  "pipeline-reset": (args) => pipelineResetCommand(args),
  "feature-status": (args) => featureStatusCommand(args),
  "start-feature": (args) => startFeature(args),
  "close-feature": (args) => closeFeature(args),
  "start-prd": (args) => startPrd(args),
  "close-prd": (args) => closePrd(args),
  "forge:start": (args) => forgeStart(args),
  "forge:open": (args) => forgeOpen(args),
  "forge:check": (args) => forgeCheck(args),
  "forge:close": (args) => forgeClose(args),
  "forge:run": (args) => forgeRun(args),
  "forge:status": (args) => forgeStatus(args),
  "forge:plan": (args) => forgePlan(args),
  "forge:next": (args) => forgeNext(args),
  "forge:release": (args) => forgeRelease(args),
  config: (args) => configCommand(args),
  schema: (args) => schemaCommand(args),
};

const rawArgs = process.argv.slice(2);
const { command, args } = resolveCommand(rawArgs);
const sessionId = resolveSessionId();
const agent = resolveAgent();

try {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const handler = commands[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}. Run 'wiki help' for usage.`);
  }
  const start = Date.now();
  let ok = true;
  let errorMsg: string | undefined;
  try {
    await handler(args);
  } catch (handlerError) {
    ok = false;
    errorMsg = (handlerError instanceof Error ? handlerError.message : String(handlerError)).slice(0, 200);
    throw handlerError;
  } finally {
    appendActivity({
      ts: new Date().toISOString(),
      sid: sessionId,
      cmd: command,
      project: extractProject(command, args),
      target: extractTarget(command, args),
      agent,
      durationMs: Date.now() - start,
      ok,
      ...(errorMsg ? { error: errorMsg } : {}),
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = typeof error === "object" && error !== null && "exitCode" in error && typeof (error as { exitCode?: unknown }).exitCode === "number"
    ? (error as { exitCode: number }).exitCode
    : 1;
  console.error(`error: ${message}`);
  process.exit(exitCode);
}

function resolveCommand(rawArgs: string[]) {
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
      distill: "research:distill",
      adopt: "research:adopt",
    }[subcommand as "scaffold" | "status" | "ingest" | "lint" | "audit" | "file" | "distill" | "adopt"];
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
  if (command === "forge") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand || subcommand === "help") throw new Error("missing forge subcommand. Run 'wiki help' for usage.");
    const mapped = {
      start: "forge:start",
      open: "forge:open",
      check: "forge:check",
      close: "forge:close",
      run: "forge:run",
      status: "forge:status",
      plan: "forge:plan",
      next: "forge:next",
      release: "forge:release",
    }[subcommand as "start" | "open" | "check" | "close" | "run" | "status" | "plan" | "next" | "release"];
    if (!mapped) throw new Error(`unknown forge subcommand: ${subcommand}. Run 'wiki help' for usage.`);
    return { command: mapped, args: subArgs };
  }
  return { command, args: rest };
}
