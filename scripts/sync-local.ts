#!/usr/bin/env bun

import { resolve } from "node:path";

export const REPO_SKILLS = ["forge", "wiki", "prd-to-slices"] as const;
export const COMPANION_SKILLS = [
  "mattpocock/skills/grill-me",
  "mattpocock/skills/write-a-prd",
  "mattpocock/skills/tdd",
] as const;

export type SyncStep = {
  label: string;
  command: string[];
};

export type SyncOptions = {
  includeCompanions: boolean;
  repoDir: string;
};

if (import.meta.main) {
  await main(process.argv.slice(2));
}

async function main(args: string[]) {
  const options = parseSyncArgs(args);
  const plan = buildSyncPlan(options);

  ensureCommand("bun", "bun is required for sync:local");
  ensureCommand("npm", "npm is required for sync:local");
  ensureCommand("npx", "npx is required for sync:local");

  console.log("wiki-forge local sync");
  console.log(`- repo: ${options.repoDir}`);
  console.log(`- companion skills: ${options.includeCompanions ? "yes" : "no"}`);

  for (const step of plan) {
    console.log(`- ${step.label}`);
    runStep(step, options.repoDir);
  }

  console.log("sync complete");
  console.log("restart your agent session to pick up refreshed skill instructions");
}

export function parseSyncArgs(args: string[], repoDir = resolve(import.meta.dir, "..")): SyncOptions {
  return {
    includeCompanions: args.includes("--with-companions"),
    repoDir,
  };
}

export function buildSyncPlan(options: SyncOptions): SyncStep[] {
  const repoSkills = REPO_SKILLS.map((skill) => ({
    label: `install repo skill ${skill}`,
    command: ["npx", "skills@latest", "add", resolve(options.repoDir, "skills", skill), "-g", "-y"],
  }));
  const companionSkills = options.includeCompanions
    ? COMPANION_SKILLS.map((skill) => ({
      label: `install companion skill ${skill.split("/").pop()}`,
      command: ["npx", "skills@latest", "add", skill, "-g", "-y"],
    }))
    : [];

  return [
    { label: "link wiki cli", command: ["bun", "link"] },
    { label: "install latest qmd", command: ["npm", "install", "-g", "@tobilu/qmd@latest", "--audit=false", "--fund=false"] },
    { label: "rebuild qmd native modules", command: ["npm", "rebuild", "-g", "@tobilu/qmd"] },
    ...repoSkills,
    ...companionSkills,
  ];
}

function ensureCommand(command: string, errorMessage: string) {
  if (!Bun.which(command)) throw new Error(errorMessage);
}

function runStep(step: SyncStep, repoDir: string) {
  const proc = Bun.spawnSync(step.command, {
    cwd: repoDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) throw new Error(`${step.label} failed with exit code ${proc.exitCode}`);
}
