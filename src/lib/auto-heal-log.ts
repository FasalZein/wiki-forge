/**
 * Shared audit-log helper for PRD-057 auto-heal entries.
 *
 * Accepts an explicit `vaultRoot` so tests can route writes to a temporary
 * vault instead of the production ~/Knowledge vault.  Never call appendLogEntry
 * from _apply() closures — that function hard-codes VAULT_ROOT and will pollute
 * production log from test runs.
 *
 * Shape (one block per action):
 *   ## [YYYY-MM-DD] auto-heal | <entity>
 *   - project: <project>
 *   - trigger=<trigger>
 *   - <extra key>=<value>
 *   - ...
 */
import { join } from "node:path";
import { appendText, ensureDir } from "./fs";

export function appendAutoHealLogEntry(
  vaultRoot: string,
  entity: string,
  project: string,
  trigger: string,
  details: string[],
): void {
  ensureDir(vaultRoot);
  const logPath = join(vaultRoot, "log.md");
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `## [${date}] auto-heal | ${entity}`,
    `- project: ${project}`,
    `- trigger=${trigger}`,
    ...details.map((d) => `- ${d}`),
    "",
  ];
  appendText(logPath, `${lines.join("\n")}\n`);
}

/**
 * Read and return recent log entries from a vaultRoot-specific log.
 * Used for idempotence checks: don't emit a second audit entry for the same
 * entity+trigger combination if one already exists in the tail.
 */
export async function tailAutoHealLog(
  vaultRoot: string,
  count: number,
): Promise<string[]> {
  const logPath = join(vaultRoot, "log.md");
  const { exists, readText } = await import("./fs");
  if (!(await exists(logPath))) return [];
  const content = (await readText(logPath)).replace(/\r\n/g, "\n");
  const entries = content.split(/^## /mu).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}
