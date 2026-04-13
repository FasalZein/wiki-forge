import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { PROJECT_FILES, VAULT_ROOT, VAULT_ROOT_ENV } from "./constants";
import type { FrontmatterData } from "./types";

export function printHelp() {
  console.log(`wiki CLI

Usage:
  wiki research scaffold <topic>
  wiki research status [topic] [--json]
  wiki research ingest <topic> <source-url-or-path...> [--title <title>]
  wiki research lint [topic] [--json]
  wiki research audit [topic] [--json]
  wiki research file <project> [--topic <topic>] <title...>
  wiki source ingest <path-or-url...> [--topic <topic>] [--title <title>] [--bucket <name>]
  wiki scaffold-layer <name>
  wiki create-layer-page <layer> <title...>
  wiki lint-vault [--json]

  wiki scaffold-project <project>
  wiki backlog <project> [--json]
  wiki add-task <project> <title...> [--section <name>] [--priority <p>] [--tag <t>] [--json]
  wiki move-task <project> <task-id> --to <section>
  wiki complete-task <project> <task-id>
  wiki create-issue-slice <project> <title...> [--section <name>] [--priority <p>] [--tag <t>] [--prd <PRD-ID>] [--json]
  wiki create-feature <project> <name...>
  wiki create-prd <project> --feature <FEAT-ID> <name...> [--supersedes <PRD-ID>] [--split-from <PRD-ID>]
  wiki create-plan <project> <name...>
  wiki create-test-plan <project> <name...>
  wiki create-module <project> <module> [--source <path...>]
  wiki normalize-module <project> <module> [--write]
  wiki onboard <project> [--repo <path>]
  wiki onboard-plan <project> [--repo <path>] [--write]
  wiki ask <project> [--expand] [-n <num>] <question...>
  wiki file-answer <project> [--expand] [--slug <slug>] [-n <num>] <question...>
  wiki query [--expand] <query...>
  wiki qmd-setup
  wiki qmd-status
  wiki qmd-update
  wiki qmd-embed
  wiki dashboard <project> [--repo <path>] [--base <rev>] [--json]
  wiki handover <project> [--repo <path>] [--base <rev>] [--json]
  wiki claim <project> <slice-id> [--agent <name>] [--repo <path>] [--json]
  wiki note <project> <message...> [--agent <name>] [--slice <slice-id>] [--json]
  wiki next <project> [--json]
  wiki verify-slice <project> <slice-id> [--repo <path>] [--json]
  wiki close-slice <project> <slice-id> [--repo <path>] [--base <rev>] [--json]
  wiki doctor <project> [--repo <path>] [--base <rev>] [--json]
  wiki gate <project> [--repo <path>] [--base <rev>] [--json]
  wiki maintain <project> [--repo <path>] [--base <rev>] [--json]
  wiki refresh <project> [--repo <path>] [--json]
  wiki refresh-from-git <project> [--repo <path>] [--base <rev>] [--json]
  wiki discover <project> [--repo <path>] [--tree] [--json]
  wiki ingest-diff <project> [--repo <path>] [--base <rev>] [--json]
  wiki update-index <project>|--all [--write] [--json]
  wiki log append <kind> <title> [--project <p>] [--details <text>]
  wiki log tail [n]
  wiki obsidian open <note>
  wiki obsidian backlinks <note> [--json]
  wiki obsidian unresolved [--json]
  wiki obsidian orphans
  wiki obsidian deadends
  wiki obsidian property:set <note> <name> <value>
  wiki summary <project> [--repo <path>] [--json]
  wiki status [project] [--json]
  wiki lint <project> [--json]
  wiki lint-semantic <project> [--json]
  wiki verify <project> [--json]
  wiki search [--hybrid] <query...>
  wiki bind <project> <module-or-page> <source-path...> [--mode replace|merge] [--dry-run]
  wiki drift-check <project> [--repo <path>] [--show-unbound] [--fix] [--json]
  wiki verify-page <project> <module-or-page...> <level> [--dry-run]
  wiki verify-page <project> --all <level> [--dry-run]
  wiki migrate-verification <project>
  wiki cache-clear
  wiki setup-shell [vault-path]

Notes:
  - Maintained docs live in ~/Knowledge
  - Project repos are source inputs only
  - Use the /research skill for actual investigation; wiki research/source commands only file, scaffold, ingest, and lint research artifacts in the vault
  - search uses qmd full-text search by default
  - search --hybrid is supported, but query is the preferred hybrid retrieval command
  - query is SDK-first: location/general queries use BM25, rationale queries use pre-expanded lex+vec hybrid in-process, and --expand keeps the raw qmd expansion path
  - backlog reads project tasks by section
  - add-task appends a tracked task to backlog.md with a generated project task ID
  - move-task / complete-task update task state in backlog.md
  - create-issue-slice adds a backlog item and creates a task folder under projects/<project>/specs/slices/<TASK-ID>/ with index.md, plan.md, and test-plan.md; when --prd is provided and the parent PRD already has source_paths, the new slice docs inherit those bindings
  - create-feature allocates an immutable feature ID (FEAT-001) and scaffolds a canonical feature page under projects/<project>/specs/features/
  - create-prd requires --feature, allocates an immutable project-scoped PRD ID (PRD-001), and scaffolds a canonical PRD under projects/<project>/specs/prds/
  - create-plan / create-test-plan scaffold standalone planning docs under projects/<project>/specs/ and keep them visible in specs/index.md
  - onboard writes the scaffold and can also write a project-specific onboarding plan when --repo is provided
  - onboard-plan renders the canonical onboarding slices and can write a project-specific plan file
  - dashboard emits a single JSON overview for apps and agents
  - handover summarizes backlog focus, dirty git state, and top maintenance actions for the next agent
  - claim records slice ownership and blocks overlapping file-level claims across active/claimed slices when source_paths overlap
  - note appends a durable agent-to-agent message to the global wiki log with project/slice metadata
  - next recommends the highest-priority active or ready slice, skipping slices blocked by depends_on
  - verify-slice runs shell command blocks from a slice test-plan and promotes the test-plan to test-verified on success
  - close-slice runs the project gate and moves the slice to Done only when the gate passes
  - doctor emits a comprehensive health report and score for a project
  - gate is a pass/fail completion check for missing tests, lint, and uncovered changed files
  - maintain composes refresh-from-git, discover, lint, and semantic lint into a task queue
  - refresh-from-git maps recent code changes to impacted wiki pages and uncovered files
  - ingest-diff applies a first-pass sync: appends change digests to impacted pages and scaffolds missing module pages for uncovered changed files
  - discover surfaces uncovered repo files, unbound pages, and placeholder-heavy pages
  - update-index maintains generated index pages and refreshes code-driven relationship sections across planning docs, modules, and freeform project zones (dry-run by default)
  - log appends/tails chronological wiki operations in log.md
  - wiki obsidian ... wraps a small app-dependent Obsidian CLI surface for vault-aware UI actions
  - ask reranks qmd results toward projects/<project>/ and prints a citation-ready brief
  - ask is SDK-first: location/general questions use a faster project-aware BM25 path, rationale questions use in-process pre-expanded hybrid retrieval
  - file-answer saves an ask brief into wiki/syntheses/
  - use grouped commands: wiki research ..., wiki source ...
  - research file scaffolds a project research note into research/projects/<project>/ by default; it does not perform the research step
  - research scaffold creates a topic container with research/<topic>/_overview.md
  - research status reports research counts by status and verification level
  - research audit layers dead-link checks and influenced_by coverage on top of research lint/status
  - research ingest scaffolds a source-backed research page inside a topic for findings you already gathered
  - source ingest copies a local file into raw/ or creates a raw URL pointer note, then scaffolds a linked research summary
  - research/source paths are mechanical: research expects research/<topic>/{_overview,<slug>}.md and raw expects bucketed paths under raw/
  - research lint flags missing sources, stale unverified notes, unattributed claims, unlinked research pages, and misplaced research/raw files
  - scaffold-layer/create-layer-page are the plugin-generated extension path for custom top-level layers such as books
  - lint-vault hard-fails unknown top-level layers or invalid custom-layer paths
  - query --expand uses qmd's raw natural-language expansion path
  - qmd CLI is still used for maintenance/admin commands; retrieval commands prefer the in-process SDK path
  - set QMD_INDEX_NAME to route wiki/qmd commands to a named qmd index (useful for isolated benchmarks)
  - set ${VAULT_ROOT_ENV} when the CLI is installed outside the vault repo
  - bind manages source_paths (repo-relative code paths) on a wiki page's frontmatter; default mode is replace, and --mode merge appends normalized unique paths without dropping existing bindings
  - drift-check compares git modification times of source files against wiki page updated dates
  - drift-check also detects simple rename candidates from git history
  - drift-check --show-unbound lists pages without source_paths
  - drift-check --fix auto-demotes stale/deleted pages to verification_level: stale in frontmatter
  - refresh-from-git includes compact git diff summaries for impacted pages
  - lint-semantic flags orphan pages, dead-end pages, unbound module pages, and placeholder-heavy pages
  - verify-page promotes a page to a verification level (scaffold|inferred|code-verified|runtime-verified|test-verified)
  - cache-clear removes .cache/wiki-cli/
  - setup-shell adds KNOWLEDGE_VAULT_ROOT to your shell config (zsh/bash/fish)
  - migrate-verification converts old verified_code/runtime/tests booleans to verification_level
`);
}

export function projectRoot(project: string) {
  return join(VAULT_ROOT, "projects", project);
}

export function resolveWikiPagePath(projectRootPath: string, pageArg: string): string {
  const directPath = join(projectRootPath, pageArg);
  if (existsSync(directPath)) return directPath;

  if (!pageArg.endsWith(".md")) {
    const withMd = join(projectRootPath, `${pageArg}.md`);
    if (existsSync(withMd)) return withMd;
  }

  const moduleSpec = join(projectRootPath, "modules", pageArg, "spec.md");
  if (existsSync(moduleSpec)) return moduleSpec;

  return directPath;
}

export function safeMatter(pathLabel: string, content: string, options?: { silent?: boolean }) {
  try {
    return matter(content) as { content: string; data: FrontmatterData };
  } catch (error) {
    if (!options?.silent) {
      console.warn(`warning: could not parse frontmatter for ${pathLabel}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

export function orderFrontmatter(data: FrontmatterData, preferredOrder: string[]) {
  const ordered: FrontmatterData = {};
  for (const key of preferredOrder) {
    if (key in data) {
      ordered[key] = data[key];
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return ordered;
}

export function normalizeFrontmatterFormatting(serialized: string, data: FrontmatterData) {
  let result = serialized;

  if (data.updated instanceof Date) {
    const dateStr = data.updated.toISOString().slice(0, 10);
    result = result.replace(/^updated:\s+.*$/m, `updated: ${dateStr}`);
  } else if (typeof data.updated === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(data.updated)) {
    result = result.replace(/^updated:\s+.*$/m, `updated: ${data.updated}`);
  }

  if (data.stale_since instanceof Date) {
    const dateStr = data.stale_since.toISOString().slice(0, 10);
    result = result.replace(/^stale_since:\s+.*$/m, `stale_since: ${dateStr}`);
  } else if (typeof data.stale_since === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(data.stale_since)) {
    result = result.replace(/^stale_since:\s+.*$/m, `stale_since: ${data.stale_since}`);
  }

  return result;
}

export function moduleTitle(moduleName: string) {
  return `${moduleName
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")} Module`;
}

export function findTableSpacingProblems(content: string): string[] {
  const lines = content.split("\n");
  const problems: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("|")) {
      continue;
    }
    const previous = lines[index - 1] ?? "";
    if (previous.trim() && !previous.trimStart().startsWith("|")) {
      problems.push(`table near line ${index + 1} should be preceded by a blank line`);
    }
  }
  return problems;
}

export function scaffoldFile(project: string, file: (typeof PROJECT_FILES)[number]) {
  switch (file) {
    case "_summary.md":
      return `---\ntitle: "${project}"\ntype: project\nproject: ${project}\nupdated: ${today()}\nstatus: scaffold\nverification_level: scaffold\n---\n\n# ${project}\n\n> [!summary]\n> Canonical project hub for \`${project}\`. Keep this note aligned with code, active slices, and research.\n\n## Current Focus\n\n- \n\n## Cross Links\n\n- [[projects/${project}/backlog]]\n- [[projects/${project}/decisions]]\n- [[projects/${project}/learnings]]\n- [[projects/${project}/specs/index]]\n`;
    case "backlog.md":
      return `# Backlog\n\n> [!todo]\n> Active task tracker for this project. Move slices through the sections instead of creating ad hoc task notes.\n\n## In Progress\n\n## Todo\n\n## Backlog\n\n## Done\n\n## Cancelled\n\n## Cross Links\n\n- [[projects/${project}/_summary]]\n- [[projects/${project}/specs/index]]\n`;
    case "decisions.md":
      return `# Decisions\n\n> [!summary]\n> Record durable decisions linked back to code, specs, and research.\n\n## Entries\n\n- \n\n## Cross Links\n\n- [[projects/${project}/_summary]]\n- [[projects/${project}/specs/index]]\n`;
    case "learnings.md":
      return `# Learnings\n\n> [!summary]\n> Record durable lessons, surprises, and future guardrails discovered while shipping.\n\n## Entries\n\n- \n\n## Cross Links\n\n- [[projects/${project}/_summary]]\n- [[projects/${project}/specs/index]]\n`;
  }
}

export function writeNormalizedPage(filePath: string, content: string, data: FrontmatterData) {
  const serialized = normalizeFrontmatterFormatting(
    matter.stringify(`${content.trim()}\n`, data),
    data,
  );
  writeFileSync(filePath, serialized, "utf8");
}

export function mkdirIfMissing(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    return true;
  }
  return false;
}

export function requireValue(value: string | undefined, label: string): asserts value is string {
  if (!value) {
    fail(`missing ${label}`);
  }
}

export function assertExists(path: string, message: string) {
  if (!existsSync(path)) {
    fail(message);
  }
}

export function fail(message: string): never {
  throw new Error(message);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

export function createdAt(data: FrontmatterData) {
  if (typeof data.created_at === "string" && data.created_at.trim()) return data.created_at;
  if (data.created_at instanceof Date && !Number.isNaN(data.created_at.valueOf())) return data.created_at.toISOString();
  return nowIso();
}

export function readProjectTitle(project: string) {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!existsSync(summaryPath)) {
    return project;
  }
  const parsed = safeMatter(summaryPath, readFileSync(summaryPath, "utf8"), { silent: true });
  const title = parsed?.data.title;
  return typeof title === "string" && title.trim() ? title.trim() : project;
}
