import type { safeMatter } from "../cli-shared";

/** A page under specs/slices/ whose frontmatter status is "done" — historical, not actionable. */
export function isHistoricalDoneSlicePage(entry: { page: string; parsed: ReturnType<typeof safeMatter> | null }): boolean {
  if (!entry.parsed) return false;
  if (!/^specs\/slices\/[^/]+\//.test(entry.page)) return false;
  return entry.parsed.data.status === "done";
}
