import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { appendText, ensureDir, exists, readText } from "./fs";

export function logPath() {
  return join(VAULT_ROOT, "log.md");
}

export function appendLogEntry(kind: string, title: string, options?: { project?: string; details?: string[] }) {
  const path = logPath();
  ensureDir(VAULT_ROOT);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`## [${date}] ${kind} | ${title}`];
  if (options?.project) lines.push(`- project: ${options.project}`);
  for (const detail of options?.details ?? []) lines.push(`- ${detail}`);
  lines.push("");
  appendText(path, `${lines.join("\n")}\n`);
}

export async function tailLog(count = 10) {
  const path = logPath();
  if (!(await exists(path))) return [] as string[];
  const content = (await readText(path)).replace(/\r\n/g, "\n");
  const entries = content.split(/^## /m).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}
