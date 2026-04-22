import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadSkillCandidateTargets } from "./targets";
import { assertValidSkillCandidateRewrite } from "./skill-guard";
import type { SkillCandidateRecord } from "./types";

async function readCandidate(skillName: string) {
  const path = join(import.meta.dir, "..", "outputs", "skill-candidates", `${skillName}.candidate.json`);
  return JSON.parse(await readFile(path, "utf8")) as SkillCandidateRecord;
}

async function ensureParent(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

function normalizePatchPaths(
  patch: string,
  sourcePath: string,
  absoluteSourcePath: string,
  absoluteProposedPath: string,
) {
  return patch
    .replaceAll(`a${absoluteSourcePath}`, `a/${sourcePath}`)
    .replaceAll(`b${absoluteProposedPath}`, `b/${sourcePath}`)
    .replaceAll(absoluteSourcePath, sourcePath)
    .replaceAll(absoluteProposedPath, sourcePath);
}

async function generatePatch(candidate: SkillCandidateRecord) {
  const repoRoot = join(import.meta.dir, "..", "..", "..");
  const sourcePath = join(repoRoot, candidate.sourcePath);
  const currentSkill = await readFile(sourcePath, "utf8");
  const target = (await loadSkillCandidateTargets()).find((entry) => entry.skillName === candidate.skillName);
  assertValidSkillCandidateRewrite({
    currentSkill,
    revisedSkill: candidate.revisedSkill,
    target,
  });
  const proposedPath = join(import.meta.dir, "..", "outputs", "skill-candidates", "proposed", candidate.sourcePath);
  const patchPath = join(import.meta.dir, "..", "outputs", "skill-candidates", `${candidate.skillName}.candidate.patch`);

  await ensureParent(proposedPath);
  await writeFile(proposedPath, candidate.revisedSkill, "utf8");

  const proc = Bun.spawnSync({
    cmd: [
      "git",
      "diff",
      "--no-index",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      sourcePath,
      proposedPath,
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0 && proc.exitCode !== 1) {
    throw new Error(stderr || `git diff failed with exit code ${proc.exitCode}`);
  }

  const normalizedPatch = normalizePatchPaths(stdout, candidate.sourcePath, sourcePath, proposedPath);
  await writeFile(patchPath, normalizedPatch, "utf8");
  return {
    skillName: candidate.skillName,
    sourcePath: candidate.sourcePath,
    proposedPath,
    patchPath,
    changed: normalizedPatch.trim().length > 0,
  };
}

export async function runSkillPromotion(skillName?: string) {
  const targets = skillName ? [skillName] : ["wiki", "forge"];
  const results = [];
  const rejected = [];
  for (const target of targets) {
    const patchPath = join(import.meta.dir, "..", "outputs", "skill-candidates", `${target}.candidate.patch`);
    try {
      const candidate = await readCandidate(target);
      results.push(await generatePatch(candidate));
    } catch (error) {
      await rm(patchPath, { force: true });
      rejected.push({
        skillName: target,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { promoted: results, rejected };
}
