import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_ROOT } from "../constants";

export function logPath() {
  return join(VAULT_ROOT, "log.md");
}

export function appendLogEntry(kind: string, title: string, options?: { project?: string; details?: string[] }) {
  const path = logPath();
  mkdirSync(VAULT_ROOT, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`## [${date}] ${kind} | ${title}`];
  if (options?.project) lines.push(`- project: ${options.project}`);
  for (const detail of options?.details ?? []) lines.push(`- ${detail}`);
  lines.push("");
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

export function tailLog(count = 10) {
  const path = logPath();
  if (!existsSync(path)) return [] as string[];
  const content = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const entries = content.split(/^## /m).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}
