import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { appendText, ensureDir } from "./fs";

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

export function tailLog(count = 10) {
  const path = logPath();
  // TODO: migrate to async exists()
  if (!existsSync(path)) return [] as string[];
  // TODO(WIKI-FORGE-070): migrate to readText once tailLog callers (logCommand, projectLogEntries) are async
  const content = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const entries = content.split(/^## /m).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}
