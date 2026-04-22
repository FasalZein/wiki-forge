import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { requireValue, projectRoot, mkdirIfMissing } from "../../cli-shared";
import { exists, readText, writeText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { classifyProjectDocPath } from "../../lib/structure";
import { findProjectArg, parseProjectRepoBaseArgs } from "../../git-utils";
import { buildDirectoryTree, listCodeFiles, listRepoMarkdownDocs, readCodePaths } from "../../protocol/discovery/index";
import { createModuleInternal } from "../../protocol";
import { guessModuleName } from "../health";
import {
  loadProjectSnapshot,
  collectRefreshFromGit,
  type ProjectSnapshot,
} from "../shared";

export async function discoverProject(args: string[]) {
  const project = findProjectArg(args);
  requireValue(project, "project");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const json = args.includes("--json");
  const tree = args.includes("--tree");
  const result = await collectDiscoverSummary(project, repo);
  if (json) console.log(JSON.stringify(tree ? { ...result, tree: buildDirectoryTree(result.uncoveredFiles) } : result, null, 2));
  else if (tree) {
    console.log(`discover --tree for ${project}:`);
    console.log(`- repo files: ${result.repoFiles} | bound: ${result.boundFiles} | uncovered: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log("");
    const groups = buildDirectoryTree(result.uncoveredFiles);
    for (const group of groups) {
      const marker = group.files >= 3 ? "  <- module candidate" : "";
      console.log(`${group.directory}/ (${group.files} files)${marker}`);
    }
    if (result.researchDirs.length) {
      console.log("\nrepo-local research docs detected:");
      for (const dir of result.researchDirs) console.log(`  - ${dir}`);
      console.log("  - file durable findings into wiki research notes; use /research for net-new investigation");
    }
    if (result.unboundPages.length) {
      console.log("\nunbound wiki pages:");
      for (const page of result.unboundPages.slice(0, 15)) console.log(`  - ${page}`);
    }
  } else {
    console.log(`discover for ${project}:`);
    console.log(`- repo files: ${result.repoFiles}`);
    console.log(`- bound files: ${result.boundFiles}`);
    console.log(`- uncovered files: ${result.uncoveredFiles.length}`);
    console.log(`- unbound pages: ${result.unboundPages.length}`);
    console.log(`- placeholder-heavy pages: ${result.placeholderHeavyPages.length}`);
    console.log(`- repo docs to move: ${result.repoDocFiles.length}`);
    for (const file of result.uncoveredFiles.slice(0, 20)) console.log(`  - uncovered: ${file}`);
    for (const file of result.repoDocFiles.slice(0, 20)) console.log(`  - repo-doc: ${file}`);
  }
}

export async function collectDiscoverSummary(project: string, explicitRepo?: string, snapshot?: ProjectSnapshot) {
  const state = snapshot ?? await loadProjectSnapshot(project, explicitRepo, { includeRepoInventory: true });
  const boundFiles = new Set<string>();
  const unboundPages: string[] = [];
  const placeholderHeavyPages: string[] = [];
  for (const entry of state.pageEntries) {
    if (!entry.parsed) continue;
    const kind = classifyProjectDocPath(entry.relPath);
    if (!entry.sourcePaths.length && kind !== "session-handover") unboundPages.push(entry.page);
    for (const sourcePath of entry.sourcePaths) boundFiles.add(sourcePath);
    if (entry.todoCount >= 6) placeholderHeavyPages.push(entry.page);
  }
  const researchDirs: string[] = [];
  for (const candidate of ["docs/research", "docs", "research", "docs/specs"]) {
    const candidatePath = join(state.repo, candidate);
    if (await exists(candidatePath)) {
      try {
        const count = [...new Bun.Glob("**/*.md").scanSync({ cwd: candidatePath, onlyFiles: true })].length;
        if (count > 0) researchDirs.push(`${candidate}/ (${count} docs)`);
      } catch {}
    }
  }
  const repoFiles = state.repoFiles ?? listCodeFiles(state.repo, await readCodePaths(project));
  const repoDocFiles = state.repoDocFiles ?? await listRepoMarkdownDocs(state.repo);
  return { project, repo: state.repo, repoFiles: repoFiles.length, boundFiles: boundFiles.size, uncoveredFiles: repoFiles.filter((file) => !boundFiles.has(file)), unboundPages: unboundPages.sort(), placeholderHeavyPages: placeholderHeavyPages.sort(), researchDirs, repoDocFiles };
}

export async function collectIngestDiff(project: string, base: string, explicitRepo?: string) {
  const refresh = await collectRefreshFromGit(project, base, explicitRepo);
  const created: string[] = [];
  const updated: string[] = [];
  for (const page of refresh.impactedPages) {
    const pagePath = join(projectRoot(project), page.page);
    const raw = await readText(pagePath);
    const stamp = `\n## Change Digest\n\n- Updated from git diff base \`${base}\`\n${page.matchedSourcePaths.map((source) => `- Source: \`${source}\``).join("\n")}\n`;
    const next = raw.includes("## Change Digest") ? raw.replace(/\n## Change Digest[\s\S]*$/u, stamp.trimEnd() + "\n") : `${raw.trimEnd()}${stamp}`;
    await writeText(pagePath, next);
    updated.push(relative(VAULT_ROOT, pagePath));
  }
  for (const file of refresh.uncoveredFiles) {
    const guessedModule = guessModuleName(file);
    const moduleSpec = join(projectRoot(project), "modules", guessedModule, "spec.md");
    if (await exists(moduleSpec)) continue;
    await mkdirIfMissing(join(projectRoot(project), "modules", guessedModule));
    await createModuleInternal(project, guessedModule, [file]);
    created.push(relative(VAULT_ROOT, moduleSpec));
  }
  return { project, repo: refresh.repo, base, created, updated, refresh };
}

export async function ingestDiff(args: string[]) {
  const options = await parseProjectRepoBaseArgs(args);
  const json = args.includes("--json");
  const result = await collectIngestDiff(options.project, options.base, options.repo);
  appendLogEntry("ingest-diff", options.project, { project: options.project, details: [`base=${options.base}`, `created=${result.created.length}`, `updated=${result.updated.length}`] });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ingest-diff for ${options.project}:`);
    for (const file of result.created) console.log(`- created ${file}`);
    for (const file of result.updated) console.log(`- updated ${file}`);
  }
}
