import { resolveRepoPath } from "../lib/verification";
import { collectDirtyRepoStatus } from "../lib/dirty-repo";

export { parseProjectRepoBaseArgs } from "../git-utils";

export async function resolveDirtyOverlap(project: string, explicitRepo: string | undefined, sourcePaths: string[]) {
  if (!sourcePaths.length) return [] as string[];
  try {
    const repo = await resolveRepoPath(project, explicitRepo);
    const dirty = await collectDirtyRepoStatus(repo);
    const dirtyFiles = new Set([...dirty.modifiedFiles, ...dirty.untrackedFiles, ...dirty.stagedFiles]);
    return sourcePaths.filter((path) => dirtyFiles.has(path));
  } catch {
    return [] as string[];
  }
}

export { startSlice } from "./start";
export { claimSlice } from "./claim";
export { verifySlice } from "./verify";
export { closeSlice } from "./close";
