import { readdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { projectRoot } from "../../cli-shared";
import { exists } from "../../lib/fs";
import { normalizeTopicPath, slugifySegment } from "../../lib/research";

export type ResearchProjectRouting = {
  readonly project?: string;
  readonly global: boolean;
};

export async function assertProjectExists(project: string): Promise<void> {
  if (!await exists(projectRoot(project))) throw new Error(`project not found: ${project}`);
}

export async function assertGlobalResearchAllowed(topic: string, global: boolean): Promise<void> {
  if (global) return;
  const matchingProject = findMatchingProjectForTopic(topic);
  if (!matchingProject) return;
  throw new Error([
    `research topic '${topic}' matches existing project '${matchingProject}'.`,
    `Project-bound research must be filed under projects/${matchingProject}/research with --project ${quoteValue(matchingProject)}.`,
    "Use --global only for reusable cross-project research.",
  ].join(" "));
}

export function readResearchProjectRouting(args: readonly string[]): ResearchProjectRouting {
  let project: string | undefined;
  let global = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") {
      project = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--global") global = true;
  }
  if (project && global) throw new Error("choose either --project or --global, not both");
  return { ...(project ? { project } : {}), global };
}

export function isResearchRoutingFlag(flag: string): boolean {
  return flag === "--project" || flag === "--global";
}

function findMatchingProjectForTopic(topic: string): string | null {
  const normalizedTopic = normalizeTopicPath(topic);
  const firstSegment = normalizedTopic.split("/")[0];
  if (!firstSegment) return null;
  for (const project of listProjects()) {
    const normalizedProject = slugifySegment(project);
    if (normalizedProject === firstSegment || normalizedProject === normalizedTopic) return project;
  }
  return null;
}

function listProjects(): readonly string[] {
  try {
    return readdirSync(join(VAULT_ROOT, "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Error) return [];
    throw error;
  }
}

function quoteValue(value: string): string {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}
