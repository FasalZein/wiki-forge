import { collectGitTruth } from "../../forge/core/git-truth";

export type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

export async function collectDirtyRepoStatus(repo: string): Promise<DirtyRepoStatus> {
  const truth = await collectGitTruth(repo);
  return {
    modifiedFiles: [...new Set([...truth.unstaged, ...truth.deleted])].sort(),
    untrackedFiles: truth.untracked,
    stagedFiles: truth.staged,
  };
}
