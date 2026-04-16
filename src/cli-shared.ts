import { mkdirSync, writeFileSync } from "node:fs";
import { exists, readText } from "./lib/fs";
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
  wiki protocol sync <project> [--repo <path>] [--json]
  wiki protocol audit <project> [--repo <path>] [--json]
  wiki scaffold-layer <name>
  wiki create-layer-page <layer> <title...>
  wiki lint-vault [--json]

  wiki scaffold-project <project>
  wiki backlog <project> [--assignee <agent>] [--json]
  wiki add-task <project> <title...> [--section <name>] [--priority <p>] [--tag <t>] [--json]
  wiki move-task <project> <task-id> --to <section>
  wiki complete-task <project> <task-id>
  wiki create-issue-slice <project> <title...> [--section <name>] [--priority <p>] [--tag <t>] [--prd <PRD-ID>] [--assignee <agent>] [--source <path...>] [--json]
  wiki create-feature <project> <name...>
  wiki create-prd <project> --feature <FEAT-ID> <name...> [--supersedes <PRD-ID>] [--split-from <PRD-ID>]
  wiki create-plan <project> <name...>
  wiki create-test-plan <project> <name...>
  wiki create-module <project> <module> [--source <path...>]
  wiki normalize-module <project> <module> [--write]
  wiki onboard <project> [--repo <path>]
  wiki onboard-plan <project> [--repo <path>] [--write]
  wiki ask <project> [--expand] [--verbose] [-n <num>] <question...>
  wiki file-answer <project> [--expand] [--verbose] [--slug <slug>] [-n <num>] <question...>
  wiki query [--expand] <query...>
  wiki qmd-setup
  wiki qmd-status
  wiki qmd-update
  wiki qmd-embed
  wiki dashboard <project> [--repo <path>] [--base <rev>] [--json]
  wiki closeout <project> [--repo <path>] [--base <rev>] [--worktree] [--json] [--verbose]
  wiki commit-check <project> [--repo <path>] [--json] [--verbose]
  wiki checkpoint <project> [--repo <path>] [--json]
  wiki lint-repo <project> [--repo <path>] [--json]
  wiki install-git-hook <project> [--repo <path>] [--hook <name>] [--force] [--json]
  wiki refresh-on-merge <project> [--repo <path>] [--base <rev>] [--json] [--verbose]
  wiki dependency-graph <project> [--write] [--json]
  wiki handover <project> [--repo <path>] [--base <rev>] [--json]
  wiki claim <project> <slice-id> [--agent <name>] [--repo <path>] [--json]
  wiki note <project> <message...> [--agent <name>] [--slice <slice-id>] [--json]
  wiki next <project> [--json]
  wiki start-slice <project> <slice-id> [--agent <name>] [--repo <path>] [--json]
  wiki verify-slice <project> <slice-id> [--repo <path>] [--json]
  wiki close-slice <project> <slice-id> [--repo <path>] [--base <rev>] [--worktree] [--force] [--json]
  wiki pipeline <project> <slice-id> --phase <close|verify> [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json]
  wiki export-prompt <project> <slice-id> [--agent codex|claude|pi]
  wiki resume <project> [--repo <path>] [--base <rev>] [--json]
  wiki doctor <project> [--repo <path>] [--base <rev>] [--json]
  wiki gate <project> [--repo <path>] [--base <rev>] [--worktree] [--structural-refactor] [--json]
  wiki maintain <project> [--repo <path>] [--base <rev>] [--worktree] [--json]
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
  - protocol sync/audit manage repo-root (and optional nested) AGENTS.md / CLAUDE.md files from a short wiki-forge-managed agent protocol block
  - Use the /research skill for actual investigation; wiki research/source commands only file, scaffold, ingest, and lint research artifacts in the vault
  - search uses qmd full-text search by default
  - search --hybrid is supported, but query is the preferred hybrid retrieval command
  - query is SDK-first: location/general queries use BM25, rationale queries use pre-expanded lex+vec hybrid in-process when available, and --expand uses SDK auto-expansion
  - backlog reads project tasks by section, can filter by assignee, and shows blocked slices via depends_on
  - add-task appends a tracked task to backlog.md with a generated project task ID
  - move-task / complete-task update task state in backlog.md
  - create-issue-slice adds a backlog item and creates a task folder under projects/<project>/specs/slices/<TASK-ID>/ with index.md, plan.md, and test-plan.md; --assignee writes assignee frontmatter, and --source overrides inherited parent-PRD source_paths when provided
  - if projects/<project>/_summary.md defines frontmatter agents: [...], assignee values are validated against that registry
  - create-feature allocates an immutable feature ID (FEAT-001) and scaffolds a canonical feature page under projects/<project>/specs/features/
  - create-prd requires --feature, allocates an immutable project-scoped PRD ID (PRD-001), and scaffolds a canonical PRD under projects/<project>/specs/prds/
  - create-plan / create-test-plan scaffold standalone planning docs under projects/<project>/specs/ and keep them visible in specs/index.md
  - onboard writes the scaffold and can also write a project-specific onboarding plan when --repo is provided
  - onboard-plan renders the canonical onboarding slices and can write a project-specific plan file
  - dashboard emits a single JSON overview for apps and agents
  - closeout composes refresh-from-git, drift, lint, semantic lint, and gate into one compact review surface; use --worktree to evaluate dirty files instead of committed diff ranges
  - commit-check inspects staged repo files against bound wiki pages and fails when staged code would leave pages stale
  - checkpoint is the git-independent freshness check: it compares worktree mtimes against bound wiki pages and reports stale pages plus unbound changed files
  - lint-repo flags repo-owned markdown files outside the allowed set (README.md, CHANGELOG.md, AGENTS.md, CLAUDE.md, SETUP.md, skills/*/SKILL.md)
  - install-git-hook writes a repo-local hook that runs wiki commit-check before commit
  - refresh-on-merge is a CI-friendly merge check that wraps refresh-from-git, drift status, and gate output
  - dependency-graph generates a derived JSON Canvas dependency graph from feature/PRD/slice metadata and checks for missing refs/cycles
  - handover summarizes backlog focus, dirty git state, session activity (auto-tracked commands, slice transitions, errors), and top maintenance actions for the next agent
  - claim records slice ownership and blocks overlapping file-level claims across active/claimed slices when source_paths overlap
  - note appends a durable agent-to-agent message to the global wiki log with project/slice metadata
  - next recommends the highest-priority active or ready slice, skipping slices blocked by depends_on
  - start-slice is the lifecycle entry point: it checks dependencies, registers the claim, moves the backlog item to In Progress, stamps started_at, and prints a compact plan summary
  - verify-slice runs shell command blocks from a slice test-plan and promotes the test-plan to test-verified on success
  - close-slice runs the project gate, marks slice docs done, records completed_at, moves the slice to Done, and refreshes navigation indexes; use --worktree to close against dirty agent changes before commit; use --force to skip gate/closeout blockers when they originate from unrelated cross-slice work (slice-level prerequisites are still enforced)
  - pipeline automates mechanical workflow steps so agents only fill content; --phase close runs checkpoint, lint-repo, maintain, update-index; --phase verify runs verify-slice, closeout, gate, close-slice; steps are tracked in sqlite and skipped on re-run; --dry-run shows what would execute
  - export-prompt prints a self-contained execution prompt for codex, claude, or pi without writing into the project repo
  - resume prints a quick session pickup view: recent commits, dirty files, stale pages, active slice, and next actions
  - doctor emits a comprehensive health report and score for a project
  - gate is a pass/fail completion check for missing tests, lint, uncovered changed files, and backlog/slice consistency warnings; --worktree evaluates the live dirty worktree instead of committed diff ranges, and --structural-refactor relaxes direct changed-test matching only when typecheck/build/test parity still holds
  - maintain composes refresh-from-git, discover, lint, and semantic lint into a task queue; --worktree switches the refresh surface to the live worktree; automatically repairs done-slice metadata drift
  - refresh-from-git maps recent code changes to impacted wiki pages and uncovered files
  - ingest-diff applies a first-pass sync: appends change digests to impacted pages and scaffolds missing module pages for uncovered changed files
  - discover surfaces uncovered repo files, unbound pages, and placeholder-heavy pages
  - update-index maintains generated workspace/project index views, including root project navigation and projects/_dashboard.md, and refreshes code-driven relationship sections across planning docs, modules, and freeform project zones (dry-run by default)
  - log appends/tails chronological wiki operations in log.md
  - wiki obsidian ... wraps a small app-dependent Obsidian CLI surface for vault-aware UI actions
  - ask reranks qmd results toward projects/<project>/ and prints a compact citation-ready brief by default; use --verbose for routing/source sections
  - ask is SDK-first: location/general questions use a faster project-aware BM25 path, rationale questions use in-process pre-expanded hybrid retrieval
  - file-answer saves an ask brief into wiki/syntheses/ and keeps CLI output compact unless --verbose is set
  - use grouped commands: wiki research ..., wiki source ...
  - research file scaffolds a project research note into research/projects/<project>/ by default; it does not perform the research step
  - research scaffold creates a topic container with research/<topic>/_overview.md
  - research status reports research counts by status and verification level
  - research audit layers dead-link checks and influenced_by coverage on top of research lint/status
  - research ingest scaffolds a source-backed research page inside a topic for findings you already gathered
  - source ingest copies a local file into raw/ or creates a raw URL pointer note, then scaffolds a linked research summary
  - protocol sync prepends a managed agent protocol block to AGENTS.md / CLAUDE.md and preserves local notes below it; declare nested scopes in projects/<project>/_summary.md frontmatter protocol_scopes: [...]
  - protocol audit reports missing or stale managed protocol files for the expected scopes
  - research/source paths are mechanical: research expects research/<topic>/{_overview,<slug>}.md and raw expects bucketed paths under raw/
  - research lint flags missing sources, stale unverified notes, unattributed claims, unlinked research pages, and misplaced research/raw files
  - scaffold-layer/create-layer-page are the plugin-generated extension path for custom top-level layers such as books
  - lint-vault hard-fails unknown top-level layers or invalid custom-layer paths
  - query --expand uses qmd SDK auto-expansion instead of the raw qmd CLI
  - qmd retrieval and maintenance commands now prefer the in-process SDK/Bun wrapper path instead of depending on a separately working global qmd CLI
  - set QMD_INDEX_NAME to route wiki/qmd commands to a named qmd index (useful for isolated benchmarks)
  - set ${VAULT_ROOT_ENV} when the CLI is installed outside the vault repo
  - set WIKI_SESSION_ID to group activity tracking entries by session (defaults to ppid+date)
  - set WIKI_AGENT_NAME to identify the agent in activity tracking (defaults to USER)
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

export async function mkdirIfMissing(path: string) {
  if (!(await exists(path))) {
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

export async function assertExists(path: string, message: string) {
  if (!(await exists(path))) {
    fail(message);
  }
}

export function fail(message: string, exitCode = 1): never {
  const error = new Error(message) as Error & { exitCode: number };
  error.exitCode = exitCode;
  throw error;
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

export async function readProjectTitle(project: string) {
  const summaryPath = join(projectRoot(project), "_summary.md");
  if (!await exists(summaryPath)) {
    return project;
  }
  const parsed = safeMatter(summaryPath, await readText(summaryPath), { silent: true });
  const title = parsed?.data.title;
  return typeof title === "string" && title.trim() ? title.trim() : project;
}
