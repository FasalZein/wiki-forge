#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_SKILLS = listRepoSkills(resolve(import.meta.dir, ".."));
export const COMPANION_SKILLS = [] as const;

export type SyncStep = {
  label: string;
  command: string[];
};

export type SyncOptions = {
  includeCompanions: boolean;
  audit: boolean;
  repoDir: string;
};

if (import.meta.main) {
  await main(process.argv.slice(2));
}

async function main(args: string[]) {
  const options = parseSyncArgs(args);
  if (options.audit) {
    const audit = auditInstalledRepoSkills(options);
    console.log("wiki-forge local skill audit");
    console.log(`- repo: ${options.repoDir}`);
    console.log(`- install root: ${audit.installRoot}`);
    for (const row of audit.rows) console.log(`- ${row.skill}: ${row.status}`);
    if (!audit.ok) process.exit(1);
    return;
  }

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
    audit: args.includes("--audit"),
    repoDir,
  };
}

export function buildSyncPlan(options: SyncOptions): SyncStep[] {
  const repoSkills = listRepoSkills(options.repoDir).map((skill) => ({
    label: `install repo skill ${skill}`,
    command: ["npx", "skills@latest", "add", resolve(options.repoDir, "skills", skill), "-g"],
  }));
  const companionSkills = options.includeCompanions
    ? COMPANION_SKILLS.map((skill) => ({
      label: `install companion skill ${skill.split("/").pop()}`,
      command: ["npx", "skills@latest", "add", skill, "-g"],
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

export function listRepoSkills(repoDir: string): string[] {
  const skillsDir = resolve(repoDir, "skills");
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(skillsDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function auditInstalledRepoSkills(options: Pick<SyncOptions, "repoDir">, installRoot = resolve(process.env.HOME || "~", ".agents", "skills")) {
  const rows = listRepoSkills(options.repoDir).map((skill) => {
    const repoSkillPath = resolve(options.repoDir, "skills", skill, "SKILL.md");
    const installedSkillPath = resolve(installRoot, skill, "SKILL.md");
    if (!existsSync(installedSkillPath)) return { skill, status: "missing", installedSkillPath } as const;
    const repoSkill = readFileSync(repoSkillPath, "utf8");
    const installedSkill = readFileSync(installedSkillPath, "utf8");
    return { skill, status: repoSkill === installedSkill ? "ok" : "stale", installedSkillPath } as const;
  });
  return { installRoot, rows, ok: rows.every((row) => row.status === "ok") };
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
