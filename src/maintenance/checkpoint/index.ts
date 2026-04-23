import { join, relative } from "node:path";
import { statSync } from "node:fs";
import { VAULT_ROOT } from "../../constants";
import { fail, nowIso, writeNormalizedPage } from "../../cli-shared";
import { parseProjectRepoArgs, bindingMatchesFile, gitChangedFiles } from "../../git-utils";
import { readFlagValue } from "../../lib/cli-utils";
import { parseUpdatedDate } from "../../lib/verification";
import { classifySliceLocalPageScope, collectSliceLocalContext, readSliceSourcePaths } from "../../slice/docs";
import { classifyFreshnessChurn } from "../freshness-classifier";
import { loadProjectSnapshot } from "../shared";

type CheckpointPageStatus = {
  page: string;
  matchedSourcePaths: string[];
  lastSourceChange: string;
  pageUpdated: string;
  stale: boolean;
  modified: boolean;
  scope: string | null;
};

export async function checkpoint(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const sliceLocal = args.includes("--slice-local");
  const sliceId = readFlagValue(args, "--slice-id");
  const base = readFlagValue(args, "--base");
  const strictFreshness = args.includes("--strict-freshness");
  const result = await collectCheckpoint(
    options.project,
    options.repo,
    sliceLocal && sliceId ? { sliceId, ...(base ? { base } : {}), strictFreshness } : { ...(base ? { base } : {}), strictFreshness },
  );
  if (json) console.log(JSON.stringify(result, null, 2));
  else renderCheckpoint(result);
  if (!result.clean) fail(`checkpoint found ${result.stalePages.length} stale page(s) for ${options.project}`);
}

export async function collectCheckpoint(project: string, explicitRepo?: string, sliceFilter?: { sliceId?: string; base?: string; strictFreshness?: boolean }) {
  const snapshot = await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const sliceSourcePaths = sliceFilter?.sliceId
    ? await readSliceSourcePaths(project, sliceFilter.sliceId)
    : null;
  const sliceLocalContext = sliceFilter?.sliceId
    ? await collectSliceLocalContext(project, sliceFilter.sliceId, snapshot.pageEntries)
    : null;
  const changedFiles = sliceFilter?.base
    ? await gitChangedFiles(snapshot.repo, sliceFilter.base)
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
  const pageStatuses = new Map<string, { page: string; file: string; parsed: NonNullable<(typeof snapshot.pageEntries)[number]["parsed"]>; matchedSourcePaths: Set<string>; lastSourceChangeMs: number; pageUpdatedMs: number | null; pageUpdated: string; broadBinding: boolean }>();
  const filesToInspect = changedFiles ?? snapshot.repoFiles ?? [];
  const churn = changedFiles !== null ? classifyFreshnessChurn(changedFiles) : null;
  const canAutoHeal = changedFiles !== null && !sliceFilter?.strictFreshness && churn?.semanticNeutral === true;
  const healedAt = nowIso();
  const autoHealedPages: Array<{ page: string; matchedSourcePaths: string[]; healedAt: string; reason: string }> = [];

  // F3: under --slice-local, only files owned by the slice's source_paths drive
  // staleness. Without this, a broad-binding page (e.g. `architecture/src-layout.md`
  // bound to every file in `src/`) amplifies any in-tree modification into a stale
  // finding for every slice that overlaps `src/`.
  const fileInScope = (file: string) => {
    if (!sliceSourcePaths) return true;
    return sliceSourcePaths.some((sliceSp) => bindingMatchesFile(sliceSp, file) || bindingMatchesFile(file, sliceSp));
  };

  for (const file of filesToInspect) {
    if (!fileInScope(file)) continue;
    const absolutePath = join(snapshot.repo, file);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(absolutePath).mtimeMs;
    } catch {
      continue;
    }
    const matchedEntries = pageEntries.filter((entry): entry is (typeof pageEntries)[number] & { parsed: NonNullable<(typeof pageEntries)[number]["parsed"]> } => Boolean(entry.parsed) && entry.sourcePaths.some((sourcePath) => bindingMatchesFile(sourcePath, file)));
    if (mtimeMs > projectUpdated.getTime()) modifiedFiles.add(file);
    if (!matchedEntries.length) {
      if (mtimeMs > projectUpdated.getTime()) unboundFiles.add(file);
      continue;
    }
    for (const entry of matchedEntries) {
      const existing = pageStatuses.get(entry.page) ?? {
        page: entry.page,
        file: entry.file,
        parsed: entry.parsed,
        matchedSourcePaths: new Set<string>(),
        lastSourceChangeMs: 0,
        pageUpdatedMs: parseUpdatedDate(entry.rawUpdated)?.getTime() ?? null,
        pageUpdated: String(entry.rawUpdated ?? "missing"),
        broadBinding: readBroadBinding(entry.parsed.data),
      };
      existing.matchedSourcePaths.add(file);
      existing.lastSourceChangeMs = Math.max(existing.lastSourceChangeMs, mtimeMs);
      pageStatuses.set(entry.page, existing);
    }
  }

  const orderedPages: CheckpointPageStatus[] = [...pageStatuses.values()]
    .map((entry) => {
      const matchedSourcePaths = [...entry.matchedSourcePaths].sort();
      let pageUpdated = entry.pageUpdated;
      let pageUpdatedMs = entry.pageUpdatedMs;
      let stale = changedFiles !== null
        ? pageUpdatedMs === null || entry.lastSourceChangeMs > pageUpdatedMs
        : !entry.broadBinding && (pageUpdatedMs === null || entry.lastSourceChangeMs > pageUpdatedMs);

      if (stale && canAutoHeal) {
        pageUpdated = healedAt;
        pageUpdatedMs = new Date(healedAt).getTime();
        stale = false;
        writeNormalizedPage(entry.file, entry.parsed.content, {
          ...entry.parsed.data,
          updated: healedAt,
          freshness_healed_at: healedAt,
        });
        autoHealedPages.push({
          page: entry.page,
          matchedSourcePaths,
          healedAt,
          reason: churn?.reason ?? "semantic-neutral",
        });
      }

      return {
        page: entry.page,
        matchedSourcePaths,
        lastSourceChange: new Date(entry.lastSourceChangeMs).toISOString(),
        pageUpdated,
        stale,
        modified: entry.lastSourceChangeMs > projectUpdated.getTime(),
        scope: null,
      };
    })
    .filter((entry) => entry.modified || entry.stale)
    .sort((left, right) => left.page.localeCompare(right.page));

  const scopedPages: CheckpointPageStatus[] = sliceLocalContext
    ? orderedPages.map((entry) => ({ ...entry, scope: classifySliceLocalPageScope(entry.page, sliceLocalContext) }))
    : orderedPages;
  const blockingPageStatuses = sliceLocalContext
    ? scopedPages.filter((entry) => entry.scope === "slice")
    : scopedPages;
  const nonBlockingPageStatuses = sliceLocalContext
    ? scopedPages.filter((entry) => entry.scope !== "slice")
    : [];
  const stalePages = blockingPageStatuses
    .filter((entry) => entry.stale)
    .map((entry) => ({ page: entry.page, lastSourceChange: entry.lastSourceChange, pageUpdated: entry.pageUpdated }));
  const nonBlockingStalePages = nonBlockingPageStatuses
    .filter((entry) => entry.stale)
    .map((entry) => ({ page: entry.page, lastSourceChange: entry.lastSourceChange, pageUpdated: entry.pageUpdated, scope: entry.scope }));

  return {
    project,
    repo: snapshot.repo,
    ...(sliceFilter?.base ? { base: sliceFilter.base } : {}),
    modifiedFiles: modifiedFiles.size,
    boundPages: blockingPageStatuses.length,
    pageStatuses: blockingPageStatuses,
    stalePages,
    unboundFiles: [...unboundFiles].sort(),
    nonBlockingBoundPages: nonBlockingPageStatuses.length,
    nonBlockingPageStatuses,
    nonBlockingStalePages,
    autoHealed: {
      count: autoHealedPages.length,
      pages: autoHealedPages,
      ...(churn ? { churn } : {}),
    },
    clean: blockingPageStatuses.every((entry) => !entry.stale),
  };
}

function readBroadBinding(data: Record<string, unknown> | undefined) {
  const binding = data?.binding;
  if (!binding || typeof binding !== "object") return false;
  return (binding as Record<string, unknown>).broad === true;
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
  if (result.nonBlockingBoundPages > 0) {
    const warningCount = result.nonBlockingStalePages.length;
    console.log(`Non-blocking bound pages: ${result.nonBlockingBoundPages}`);
    if (warningCount > 0) console.log(`  ! ${warningCount} parent/project page(s) are stale but outside the active slice blocker surface`);
  }
  console.log("");
  if (result.autoHealed.count > 0) {
    console.log(`Auto-healed pages: ${result.autoHealed.count}`);
    for (const page of result.autoHealed.pages.slice(0, 50)) console.log(`  ${page.page}`);
    console.log("");
  }
  console.log(`Unbound files: ${result.unboundFiles.length}`);
  for (const file of result.unboundFiles.slice(0, 50)) console.log(`  ${file}`);
  console.log("");
  if (result.clean && result.nonBlockingStalePages.length > 0) {
    console.log(`Result: CLEAN (${result.nonBlockingStalePages.length} non-blocking stale page${result.nonBlockingStalePages.length === 1 ? "" : "s"})`);
    return;
  }
  console.log(`Result: ${result.clean ? "CLEAN" : `STALE (${result.stalePages.length} page${result.stalePages.length === 1 ? "" : "s"} need update)`}`);
}
