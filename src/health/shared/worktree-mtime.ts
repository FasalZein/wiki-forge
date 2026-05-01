import { statSync } from "node:fs";
import { join } from "node:path";

export function isWorktreeSourceNewer(repo: string, sourcePath: string, updated: Date | null) {
  if (!updated) return true;
  const absolutePath = join(repo, sourcePath);
  try {
    return statSync(absolutePath).mtimeMs > updated.getTime();
  } catch {
    return true;
  }
}
