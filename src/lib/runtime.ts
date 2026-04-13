import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const commandCache = new Map<string, string | null>();
const commandListCache = new Map<string, string[]>();

export function resolveCommandsOnPath(command: string) {
  if (commandListCache.has(command)) return commandListCache.get(command) ?? [];
  const extnames = process.platform === "win32"
    ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT", ".COM"])
    : [""];
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of extnames) {
      const candidate = join(entry, `${command}${ext}`);
      if (seen.has(candidate) || !existsSync(candidate)) continue;
      seen.add(candidate);
      try {
        const stat = statSync(candidate);
        if (!stat.isFile()) continue;
        if (process.platform !== "win32" && (stat.mode & 0o111) === 0) continue;
        resolved.push(candidate);
      } catch {
        // ignore unreadable entries
      }
    }
  }
  if (!resolved.length) {
    const single = Bun.which(command);
    if (single) resolved.push(single);
  }
  commandListCache.set(command, resolved);
  return resolved;
}

export function resolveCommandOnPath(command: string) {
  if (commandCache.has(command)) return commandCache.get(command) ?? null;
  const resolved = resolveCommandsOnPath(command)[0] ?? null;
  commandCache.set(command, resolved);
  return resolved;
}

export function assertCommandOnPath(command: string, message: string) {
  if (resolveCommandOnPath(command)) return;
  throw new Error(message);
}
