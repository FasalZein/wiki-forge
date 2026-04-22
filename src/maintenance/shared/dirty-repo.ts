import { assertGitRepo } from "../../lib/verification";

export type DirtyRepoStatus = {
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
};

export async function collectDirtyRepoStatus(repo: string): Promise<DirtyRepoStatus> {
  await assertGitRepo(repo);
  const proc = await Bun.$`git status --porcelain --untracked-files=all`.cwd(repo).quiet().nothrow();
  if (proc.exitCode !== 0) throw new Error(`git status failed for ${repo}`);
  const modifiedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  const stagedFiles: string[] = [];
  for (const line of proc.text().replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim().replaceAll("\\", "/");
    if (status === "??") {
      untrackedFiles.push(file);
      continue;
    }
    if (status[0] && status[0] !== " ") stagedFiles.push(file);
    if (status[1] && status[1] !== " ") modifiedFiles.push(file);
    else if (!stagedFiles.includes(file)) modifiedFiles.push(file);
  }
  return {
    modifiedFiles: [...new Set(modifiedFiles)].sort(),
    untrackedFiles: [...new Set(untrackedFiles)].sort(),
    stagedFiles: [...new Set(stagedFiles)].sort(),
  };
}
