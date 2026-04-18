import { nowIso, orderFrontmatter, writeNormalizedPage } from "../cli-shared";
import { gitLines } from "../git-utils";
import { appendAutoHealLogEntry, tailAutoHealLog } from "../lib/auto-heal-log";
import type { MaintenanceAction } from "../lib/diagnostics";

type CascadeRefreshTarget = {
  file: string;
  page: string;
  content: string;
  data: Record<string, unknown>;
  verifiedAgainst: string;
};

export async function verifiedCommitExists(repo: string, verifiedAgainst: string) {
  try {
    await gitLines(repo, ["rev-parse", "--verify", `${verifiedAgainst}^{commit}`]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("rev-parse")) return false;
    throw error;
  }
}

export async function filesChangedSinceVerification(repo: string, verifiedAgainst: string, sourcePaths: string[]) {
  return gitLines(repo, ["diff", "--name-only", `${verifiedAgainst}..HEAD`, "--", ...sourcePaths]);
}

export function createCascadeRefreshAction(
  project: string,
  vaultRoot: string,
  target: CascadeRefreshTarget,
  sourcePaths: string[],
  reason?: string,
): MaintenanceAction {
  return {
    kind: "write-frontmatter",
    scope: "project",
    message: `cascade-refresh ${target.page}${reason ? ` (${reason})` : ""}`,
    async _apply() {
      const recentEntries = await tailAutoHealLog(vaultRoot, 300);
      const alreadyEmitted = recentEntries.some(
        (entry) =>
          entry.includes("auto-heal | cascade-refresh") &&
          entry.includes(`page=${target.page}`) &&
          entry.includes(`sha=${target.verifiedAgainst}`),
      );
      if (alreadyEmitted) return;

      writeNormalizedPage(
        target.file,
        target.content,
        orderFrontmatter(
          {
            ...target.data,
            updated: nowIso(),
            verified_against: target.verifiedAgainst,
          },
          ["title", "type", "spec_kind", "project", "source_paths", "updated", "verified_against"],
        ),
      );
      appendAutoHealLogEntry(vaultRoot, "cascade-refresh", project, "cascade-refresh", [
        `page=${target.page}`,
        `sha=${target.verifiedAgainst}`,
        ...(reason ? [`reason=${reason}`] : []),
        `sources=${sourcePaths.join(", ")}`,
      ]);
    },
  };
}
