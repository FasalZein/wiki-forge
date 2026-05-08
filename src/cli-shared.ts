import { mkdirSync, writeFileSync } from "node:fs";
import { exists, readText } from "./lib/fs";
import { join } from "node:path";
import matter from "gray-matter";
import { PROJECT_FILES, VAULT_ROOT, VAULT_ROOT_ENV } from "./constants";
import type { FrontmatterData } from "./shared/contracts/frontmatter";
import { printError, printLine } from "./lib/cli-output";
export { readFlagValue, readFlagValues } from "./lib/cli-utils";

export const FORCE_CONFIRM_FLAG = "--yes-really-force";

const DEFAULT_HELP_TEXT = `wiki CLI — Second-brain help.

Contract:
  wiki = second brain / memory
  forge = optional workflow layer
  full catalog: wiki help --all

Retrieval:
  wiki ask <project> <question...>
  wiki search [--hybrid] <query...>
  wiki query [--expand|--bm25] <query...>
  wiki qmd-status

Research:
  wiki research file <topic> --project <project> <title>
  wiki research status [topic] [--project <project>] [--json]
  wiki research ingest <topic> --project <project> <source-url-or-path...>
  wiki research migrate-projects [--project <legacy-project>] [--to-project <project>] [--write] [--json]

Second-brain management:
  wiki scaffold-project <project>
  wiki prune-empty-dirs <project> [--write] [--json]
  wiki prune-ghost-projects [--write] [--json]
  wiki summary <project> [--repo <path>] [--json]
  wiki status [project] [--json]
  wiki resume <project> [--repo <path>] [--base <rev>] [--json]

Optional workflow:
  forge lives under: wiki forge ...
`;

const FULL_HELP_CATALOG = `Session:
  wiki resume <project> [--repo <path>] [--base <rev>] [--json]
  wiki handover <project> [--repo <path>] [--base <rev>] --summary <text> --next-action <text> --prompt <text> [--prd <id>] [--slice <id>] [--command <cmd> ...] [--json]
  wiki agent-handover <project> ...     # alias for handover; prints the user-facing prompt
  wiki next <project> [--json]
  wiki note <project> <message...> [--agent <name>] [--slice <slice-id>] [--json]
  wiki log append <kind> <title> [--project <p>] [--details <text>]
  wiki log tail [n]
  wiki export-prompt <project> <slice-id> [--agent codex|claude|pi]
  wiki prune-empty-dirs <project> [--write] [--json]
  wiki prune-ghost-projects [--write] [--json]

Workflow / Forge:
  wiki forge plan <project> <feature-name> [--repo <path>]
  wiki forge run <project> [slice-id] --repo <path>
  wiki forge next <project>

Internal / Repair:
  wiki forge start <project> [slice-id] [--agent <name>] [--repo <path>] [--json]
  wiki forge check <project> [slice-id] [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json]
  wiki forge close <project> [slice-id] [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json]
  wiki forge tdd status <project> <slice-id> [--json]
  wiki forge tdd red <project> <slice-id> --test <path> --command <cmd> [--note <text>] [--json]
  wiki forge tdd green <project> <slice-id> --test <path> --command <cmd> [--note <text>] [--json]
  wiki forge evidence <project> <slice-id> verify --command <cmd> [--verification-type targeted|full-suite] [--result passed|failed] [--json]
  wiki forge review record <project> <slice-id> --verdict <approved|needs_changes|approved_with_followups> --reviewer <name> [--model <model>] [--artifact <path>] [--blocker <text>] [--repo <path>]
  wiki forge amend <project> <closed-slice-id> --reason <text> [--title <text>] [--source <path...>] [--agent <name>] [--start] [--repo <path>] [--json]
  wiki forge status <project> [slice-id] [--json]
  wiki forge release <project> <slice-id>
  wiki maintain <project> [--repo <path>] [--base <rev>] [--worktree] [--dry-run] [--json] [--verbose]
  wiki sync <project> [--repo <path>] [--report-only] [--write] [--json]
  wiki checkpoint <project> [--repo <path>] [--base <rev>] [--json]
  wiki doctor <project> [--repo <path>] [--base <rev>] [--json]
  wiki dashboard <project> [--repo <path>] [--base <rev>] [--json]
  wiki refresh <project> [--repo <path>] [--json]
  wiki refresh-from-git <project> [--repo <path>] [--base <rev>] [--json]
  wiki discover <project> [--repo <path>] [--tree] [--json]
  wiki ingest-diff <project> [--repo <path>] [--base <rev>] [--json]
  wiki commit-check <project> [--repo <path>] [--json] [--verbose]
  wiki install-git-hook <project> [--repo <path>] [--hook <name>] [--force] [--json]
  wiki refresh-on-merge <project> [--repo <path>] [--base <rev>] [--json] [--verbose]
  wiki lint-repo <project> [--repo <path>] [--json]
  wiki config --effective|init|validate|explain [path] [--repo <path>] [--json]

Planning & Hierarchy:
  wiki feature-status <project> [--json]
  wiki dependency-graph <project> [--write] [--json]
  wiki update-index <project>|--all [--write] [--json]
  wiki summary <project> [--repo <path>] [--json]

Verification & Drift:
  wiki status [project] [--json]
  wiki lint <project> [--json]
  wiki lint-semantic <project> [--json]
  wiki verify <project> [--json]
  wiki verify-page <project> <module-or-page...> <level> [--dry-run] [--allow-downgrade]
  wiki verify-page <project> --all <level> [--dry-run] [--allow-downgrade]
  wiki bind <project> <module-or-page> <source-path...> [--mode replace|merge] [--dry-run]
  wiki drift-check <project> [--repo <path>] [--show-unbound] [--fix] [--json]
  wiki acknowledge-impact <project> <page...> [--repo <path>] [--json]

Project Setup:
  wiki scaffold-project <project>
  wiki onboard <project> [--repo <path>]
  wiki onboard-plan <project> [--repo <path>] [--write]
  wiki create-module <project> <module> [--source <path...>]
  wiki normalize-module <project> <module> [--write]
  wiki protocol sync <project> [--repo <path>] [--json]
  wiki protocol audit <project> [--repo <path>] [--json]
  wiki scaffold-layer <name>
  wiki create-layer-page <layer> <title...>
  wiki lint-vault [--json]
  wiki setup-shell [vault-path]

Retrieval:
  wiki ask <project> [--expand] [--verbose] [-n <num>] <question...>
  wiki file-answer <project> [--expand] [--verbose] [--slug <slug>] [-n <num>] <question...>
  wiki query [--expand|--bm25] <query...>
  wiki search [--hybrid] <query...>
  wiki qmd-setup
  wiki qmd-status
  wiki qmd-update
  wiki qmd-embed

Research:
  wiki research scaffold <topic>
  wiki research status [topic] [--json]
  wiki research ingest <topic> <source-url-or-path...> [--title <title>]
  wiki research lint [topic] [--json]
  wiki research audit [topic] [--json]
  wiki research file <topic> [--project <project>] <title...>
  wiki research handoff <research-page> <projects/<project>/decisions|projects/<project>/architecture/domain-language>
  wiki research bridge <research-page> --project <project> --slice <slice-id> [--json]
  wiki source ingest <path-or-url...> [--topic <topic>] [--title <title>] [--bucket <name>]

Obsidian:
  wiki obsidian open <note>
  wiki obsidian backlinks <note> [--json]
  wiki obsidian unresolved [--json]
  wiki obsidian orphans
  wiki obsidian deadends
  wiki obsidian property:set <note> <name> <value>

Utility:
  wiki cache-clear
  wiki config --effective [--json] [--repo <path>]
  wiki schema <kind> | --list

Environment:
  ${VAULT_ROOT_ENV}    vault root when CLI is installed outside the vault repo
  WIKI_SESSION_ID      group activity tracking entries by session (defaults to ppid+date)
  WIKI_AGENT_NAME      identify the agent in activity tracking (defaults to USER)
  QMD_INDEX_NAME       route wiki/qmd commands to a named qmd index
`;

export function printHelp(args: string[] = []) {
  const showAll = args.includes("--all");
  printLine(showAll ? `${DEFAULT_HELP_TEXT}\nFull command catalog:\n${FULL_HELP_CATALOG}` : DEFAULT_HELP_TEXT);
}

export function projectRoot(project: string) {
  return join(VAULT_ROOT, "projects", project);
}

export function safeMatter(pathLabel: string, content: string, options?: { silent?: boolean }) {
  let parsed: { content: string; data: FrontmatterData } | null = null;
  try {
    parsed = matter(content) as { content: string; data: FrontmatterData };
  } catch (error) {
    if (!options?.silent) {
      printError(`warning: could not parse frontmatter for ${pathLabel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return parsed;
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

export function requireForceAcknowledgement(args: string[], command: string): boolean {
  const force = args.includes("--force");
  if (force && !args.includes(FORCE_CONFIRM_FLAG)) {
    fail(
      `blocked ${command}: --force requires a second acknowledgement (${FORCE_CONFIRM_FLAG}) so you stop and rethink the override first`,
      2,
    );
  }
  return force;
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
