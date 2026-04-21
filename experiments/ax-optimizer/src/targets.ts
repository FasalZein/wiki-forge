import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SkillCandidateTarget } from "./types";

export async function loadSkillCandidateTargets(): Promise<SkillCandidateTarget[]> {
  const path = join(import.meta.dir, "..", "targets", "skill-candidates.json");
  return JSON.parse(await readFile(path, "utf8")) as SkillCandidateTarget[];
}
