import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { projectRoot, safeMatter } from "../cli-shared";
import { readText } from "./fs";

export type AgentRecord = {
  name: string;
  role?: string;
};

export function normalizeAgentName(value: string) {
  return value.trim().toLowerCase();
}

export function agentNamesEqual(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  return normalizeAgentName(left) === normalizeAgentName(right);
}

export async function readProjectAgents(project: string): Promise<AgentRecord[]> {
  const summaryPath = join(projectRoot(project), "_summary.md");
  const parsed = safeMatter(relative(VAULT_ROOT, summaryPath), await readText(summaryPath), { silent: true });
  if (!parsed || !Array.isArray(parsed.data.agents)) return [];
  const agents = parsed.data.agents as unknown[];
  const records = agents.flatMap((entry) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      return name ? [{ name }] : [];
    }
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) return [];
    const role = typeof record.role === "string" ? record.role.trim() : undefined;
    return [{ name, ...(role ? { role } : {}) }];
  });
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = normalizeAgentName(record.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function assertKnownAgent(project: string, agent: string) {
  const knownAgents = await readProjectAgents(project);
  if (!knownAgents.length) return;
  if (knownAgents.some((record) => agentNamesEqual(record.name, agent))) return;
  throw new Error(`unknown agent '${agent}'. Add it to projects/${project}/_summary.md frontmatter agents: [...] or use one of: ${knownAgents.map((record) => record.name).join(", ")}`);
}
