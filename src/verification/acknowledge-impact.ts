import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, projectRoot, requireValue, safeMatter, writeNormalizedPage } from "../cli-shared";
import { readText } from "../lib/fs";
import { resolveRepoPath, assertGitRepo } from "../lib/verification";
import { appendLogEntry } from "../lib/log";
import { gitHeadSha } from "../git-utils";
import { resolveWikiPagePath } from "./verification-shared";
import { printJson, printLine } from "../lib/cli-output";

/**
 * `wiki acknowledge-impact <project> <page>...` stamps `verified_against: <HEAD-sha>`
 * in the frontmatter of each listed page. This signals that the agent has reviewed
 * the page against the current source state and does not want `maintain` /
 * `closeout` / `refresh-from-git` to re-list it until the source changes again.
 *
 * Part of WIKI-FORGE-104.
 */
export async function acknowledgeImpact(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const explicitRepo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");

  // Collect pages (positional, excluding flags and their values)
  const pages: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === "--repo") { i++; continue; }
    if (token === "--json") continue;
    if (token.startsWith("--")) continue;
    pages.push(token);
  }
  if (pages.length === 0) throw new Error("acknowledge-impact requires at least one page");

  const repo = await resolveRepoPath(project, explicitRepo);
  await assertGitRepo(repo);
  const headSha = await gitHeadSha(repo);
  const root = projectRoot(project);

  const updated: Array<{ page: string; sha: string }> = [];
  for (const pageArg of pages) {
    const filePath = await resolveWikiPagePath(root, pageArg);
    const raw = await readText(filePath);
    const parsed = safeMatter(relative(VAULT_ROOT, filePath), raw);
    if (!parsed) throw new Error(`unable to parse frontmatter for ${pageArg}`);
    const data = { ...parsed.data, verified_against: headSha, updated: nowIso() } as Record<string, unknown>;
    writeNormalizedPage(filePath, parsed.content, data);
    updated.push({ page: relative(root, filePath).replaceAll("\\", "/"), sha: headSha });
  }

  appendLogEntry("acknowledge-impact", project, {
    project,
    details: [`pages=${updated.length}`, `sha=${headSha.slice(0, 8)}`],
  });

  if (json) {
    printJson({ project, sha: headSha, updated });
  } else {
    printLine(`acknowledge-impact for ${project}: ${updated.length} page(s) stamped with verified_against=${headSha.slice(0, 12)}`);
    for (const row of updated) printLine(`- ${row.page}`);
  }
}
