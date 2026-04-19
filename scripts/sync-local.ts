#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_SKILLS = listRepoSkills(resolve(import.meta.dir, ".."));
export const COMPANION_SKILLS = [] as const;
export const INSTALL_SETS = ["full", "wiki-only"] as const;
export type InstallSet = typeof INSTALL_SETS[number];
export const WIKI_ONLY_SKILLS = ["wiki"] as const;

export type SyncStep = {
  label: string;
  command: string[];
};

export type SyncOptions = {
  includeCompanions: boolean;
  audit: boolean;
  installSet: InstallSet;
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
    console.log(`- install set: ${options.installSet}`);
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
  console.log(`- install set: ${options.installSet}`);
  console.log(`- companion skills: ${options.includeCompanions ? "yes" : "no"}`);

  for (const step of plan) {
    console.log(`- ${step.label}`);
    runStep(step, options.repoDir);
  }

  assertInstalledRepoSkillsFresh(options);
  console.log("sync complete");
  console.log("restart your agent session to pick up refreshed skill instructions");
}

export function parseSyncArgs(args: string[], repoDir = resolve(import.meta.dir, "..")): SyncOptions {
  const installSet = parseInstallSetArg(args);
  return {
    includeCompanions: args.includes("--with-companions"),
    audit: args.includes("--audit"),
    installSet,
    repoDir,
  };
}

export function buildSyncPlan(options: SyncOptions): SyncStep[] {
  const repoSkills = selectRepoSkills(options.repoDir, options.installSet).flatMap((skill) => ([
    {
      label: `remove repo skill ${skill}`,
      command: ["npx", "skills@latest", "remove", skill, "-g", "-y"],
    },
    {
      label: `install repo skill ${skill}`,
      command: ["npx", "skills@latest", "add", resolve(options.repoDir, "skills", skill), "-g", "-y"],
    },
  ]));
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

export function listRepoSkills(repoDir: string): string[] {
  const skillsDir = resolve(repoDir, "skills");
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(skillsDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function selectRepoSkills(repoDir: string, installSet: InstallSet): string[] {
  const discovered = listRepoSkills(repoDir);
  if (installSet === "full") return discovered;
  return discovered.filter((skill) => WIKI_ONLY_SKILLS.includes(skill as typeof WIKI_ONLY_SKILLS[number]));
}

export function auditInstalledRepoSkills(options: Pick<SyncOptions, "repoDir" | "installSet">, installRoot = resolve(process.env.HOME || "~", ".agents", "skills")) {
  const rows = selectRepoSkills(options.repoDir, options.installSet).map((skill) => {
    const repoSkillPath = resolve(options.repoDir, "skills", skill, "SKILL.md");
    const installedSkillPath = resolve(installRoot, skill, "SKILL.md");
    if (!existsSync(installedSkillPath)) return { skill, status: "missing", installedSkillPath } as const;
    const repoSkill = readFileSync(repoSkillPath, "utf8");
    const installedSkill = readFileSync(installedSkillPath, "utf8");
    return { skill, status: repoSkill === installedSkill ? "ok" : "stale", installedSkillPath } as const;
  });
  return { installRoot, rows, ok: rows.every((row) => row.status === "ok") };
}

export function assertInstalledRepoSkillsFresh(options: Pick<SyncOptions, "repoDir" | "installSet">, installRoot = resolve(process.env.HOME || "~", ".agents", "skills")) {
  const audit = auditInstalledRepoSkills(options, installRoot);
  if (audit.ok) return audit;
  const failures = audit.rows
    .filter((row) => row.status !== "ok")
    .map((row) => `${row.skill}: ${row.status} (${row.installedSkillPath})`)
    .join(", ");
  throw new Error(
    `sync:local finished but installed repo skill copies are still stale under ${audit.installRoot}: ${failures}`,
  );
}

function ensureCommand(command: string, errorMessage: string) {
  if (!Bun.which(command)) throw new Error(errorMessage);
}

function parseInstallSetArg(args: string[]): InstallSet {
  if (args.includes("--wiki-only")) return "wiki-only";
  if (args.includes("--full")) return "full";
  const index = args.indexOf("--install-set");
  if (index === -1) return "full";
  const value = args[index + 1];
  if (value === "full" || value === "wiki-only") return value;
  throw new Error(`invalid --install-set value: ${value ?? "(missing)"} (expected: ${INSTALL_SETS.join(", ")})`);
}

function runStep(step: SyncStep, repoDir: string) {
  const proc = Bun.spawnSync(step.command, {
    cwd: repoDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) throw new Error(`${step.label} failed with exit code ${proc.exitCode}`);
}
