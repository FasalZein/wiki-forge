import { join } from "node:path";
import { statSync } from "node:fs";
import { fail } from "../cli-shared";
import { parseUpdatedDate } from "../lib/verification";
import { parseProjectRepoArgs, bindingMatchesFile } from "../git-utils";
import { readFlagValue } from "../lib/cli-utils";
import { readSliceSourcePaths } from "../lib/slices";
import { loadProjectSnapshot } from "./_shared";

export async function checkpoint(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const sliceLocal = args.includes("--slice-local");
  const sliceId = readFlagValue(args, "--slice-id");
  const result = await collectCheckpoint(options.project, options.repo, sliceLocal && sliceId ? { sliceId } : undefined);
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderCheckpoint(result);
  if (!result.clean) fail(`checkpoint found ${result.stalePages.length} stale page(s) for ${options.project}`);
}

export async function collectCheckpoint(project: string, explicitRepo?: string, sliceFilter?: { sliceId: string }) {
  const snapshot = await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const sliceSourcePaths = sliceFilter
    ? await readSliceSourcePaths(project, sliceFilter.sliceId)
    : null;
  const pageEntries = sliceSourcePaths
    ? snapshot.pageEntries.filter((entry) =>
        entry.sourcePaths.some((sp) =>
          sliceSourcePaths.some((sliceSp) => bindingMatchesFile(sliceSp, sp) || bindingMatchesFile(sp, sliceSp)),
        ),
      )
    : snapshot.pageEntries;
  const summaryEntry = snapshot.pageEntries.find((entry) => entry.relPath === "_summary.md");
  const projectUpdated = parseUpdatedDate(summaryEntry?.rawUpdated) ?? new Date(0);
  const modifiedFiles = new Set<string>();
  const unboundFiles = new Set<string>();
  const pageStatuses = new Map<string, { page: string; matchedSourcePaths: Set<string>; lastSourceChangeMs: number; pageUpdatedMs: number | null; pageUpdated: string }>();

  // F3: under --slice-local, only files owned by the slice's source_paths drive
  // staleness. Without this, a broad-binding page (e.g. `architecture/src-layout.md`
  // bound to every file in `src/`) amplifies any in-tree modification into a stale
  // finding for every slice that overlaps `src/`.
  const fileInScope = (file: string) => {
    if (!sliceSourcePaths) return true;
    return sliceSourcePaths.some((sliceSp) => bindingMatchesFile(sliceSp, file) || bindingMatchesFile(file, sliceSp));
  };

  for (const file of snapshot.repoFiles ?? []) {
    if (!fileInScope(file)) continue;
    const absolutePath = join(snapshot.repo, file);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(absolutePath).mtimeMs;
    } catch {
      continue;
    }
    const matchedEntries = pageEntries.filter((entry) => entry.parsed && entry.sourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, file)));
    if (mtimeMs > projectUpdated.getTime()) modifiedFiles.add(file);
    if (!matchedEntries.length) {
      if (mtimeMs > projectUpdated.getTime()) unboundFiles.add(file);
      continue;
    }
    for (const entry of matchedEntries) {
      const existing = pageStatuses.get(entry.page) ?? {
        page: entry.page,
        matchedSourcePaths: new Set<string>(),
        lastSourceChangeMs: 0,
        pageUpdatedMs: parseUpdatedDate(entry.rawUpdated)?.getTime() ?? null,
        pageUpdated: String(entry.rawUpdated ?? "missing"),
      };
      existing.matchedSourcePaths.add(file);
      existing.lastSourceChangeMs = Math.max(existing.lastSourceChangeMs, mtimeMs);
      pageStatuses.set(entry.page, existing);
    }
  }

  const orderedPages = [...pageStatuses.values()]
    .map((entry) => ({
      page: entry.page,
      matchedSourcePaths: [...entry.matchedSourcePaths].sort(),
      lastSourceChange: new Date(entry.lastSourceChangeMs).toISOString(),
      pageUpdated: entry.pageUpdated,
      stale: entry.pageUpdatedMs === null || entry.lastSourceChangeMs > entry.pageUpdatedMs,
      modified: entry.lastSourceChangeMs > projectUpdated.getTime(),
    }))
    .filter((entry) => entry.modified || entry.stale)
    .sort((left, right) => left.page.localeCompare(right.page));

  return {
    project,
    repo: snapshot.repo,
    modifiedFiles: modifiedFiles.size,
    boundPages: orderedPages.length,
    pageStatuses: orderedPages,
    stalePages: orderedPages.filter((entry) => entry.stale).map((entry) => ({ page: entry.page, lastSourceChange: entry.lastSourceChange, pageUpdated: entry.pageUpdated })),
    unboundFiles: [...unboundFiles].sort(),
    clean: orderedPages.every((entry) => !entry.stale),
  };
}

function renderCheckpoint(result: Awaited<ReturnType<typeof collectCheckpoint>>) {
  console.log(`Checkpoint: ${result.project}`);
  console.log("");
  console.log(`Modified files: ${result.modifiedFiles}`);
  console.log(`Bound wiki pages: ${result.boundPages}`);
  for (const page of result.pageStatuses) {
    if (page.stale) console.log(`  ✗ ${page.page} — stale (source ${page.lastSourceChange}, page ${page.pageUpdated})`);
    else console.log(`  ✓ ${page.page} — up to date`);
  }
  console.log("");
  console.log(`Unbound files: ${result.unboundFiles.length}`);
  for (const file of result.unboundFiles.slice(0, 50)) console.log(`  ${file}`);
  console.log("");
  console.log(`Result: ${result.clean ? "CLEAN" : `STALE (${result.stalePages.length} page${result.stalePages.length === 1 ? "" : "s"} need update)`}`);
}
