#!/usr/bin/env bun

import type { CommandHandler } from "./types";
import { printHelp, scaffoldProject, addTask, backlogCommand, moveTask, completeTask, createIssueSlice, createPrd, createPlan, createTestPlan, createModule, onboardProject, onboardPlan, normalizeModule, dashboardProject, maintainProject, refreshProject, refreshFromGit, discoverProject, ingestDiff, updateIndex, logCommand, statusProject, lintProject, lintSemanticProject, verifyProject, cacheClear } from "./commands/system";
import { doctorProject, gateProject } from "./commands/diagnostics";
import { askProject, fileAnswer, fileResearch } from "./commands/answers";
import { qmdEmbed, qmdSetup, qmdStatus, qmdUpdate, queryVault, searchVault } from "./commands/qmd-commands";
import { bindSourcePaths, driftCheck, migrateVerification, verifyPage } from "./commands/verification";
import { obsidianCommand } from "./commands/obsidian";
import { setupShell } from "./commands/setup";
import { summaryProject } from "./commands/summary";

const commands: Record<string, CommandHandler> = {
  help: () => printHelp(),
  "scaffold-project": (args) => scaffoldProject(args[0]),
  backlog: (args) => backlogCommand(args),
  "add-task": (args) => addTask(args),
  "move-task": (args) => moveTask(args),
  "complete-task": (args) => completeTask(args),
  "create-issue-slice": (args) => createIssueSlice(args),
  "create-prd": (args) => createPrd(args),
  "create-plan": (args) => createPlan(args),
  "create-test-plan": (args) => createTestPlan(args),
  "create-module": (args) => createModule(args),
  onboard: (args) => onboardProject(args),
  "onboard-plan": (args) => onboardPlan(args),
  "normalize-module": (args) => normalizeModule(args),
  dashboard: (args) => dashboardProject(args),
  doctor: (args) => doctorProject(args),
  gate: (args) => gateProject(args),
  maintain: (args) => maintainProject(args),
  refresh: (args) => refreshProject(args),
  "refresh-from-git": (args) => refreshFromGit(args),
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
  "file-research": (args) => fileResearch(args),
  "qmd-status": () => qmdStatus(),
  "qmd-update": () => qmdUpdate(),
  "qmd-embed": () => qmdEmbed(),
  "qmd-setup": () => qmdSetup(),
  bind: (args) => bindSourcePaths(args),
  "drift-check": (args) => driftCheck(args),
  "verify-page": (args) => verifyPage(args),
  "migrate-verification": (args) => migrateVerification(args[0]),
  "cache-clear": () => cacheClear(),
  summary: (args) => summaryProject(args),
  "setup-shell": (args) => setupShell(args),
};

const [rawCommand = "help", ...rest] = process.argv.slice(2);
const command = rawCommand === "--help" || rawCommand === "-h" ? "help" : rawCommand;

try {
  if (rest.includes("--help") || rest.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const handler = commands[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}. Run 'wiki help' for usage.`);
  }
  await handler(rest);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
