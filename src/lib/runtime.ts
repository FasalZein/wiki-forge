import { statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { exists } from "./fs";

const commandCache = new Map<string, string | null>();
const commandListCache = new Map<string, string[]>();

async function resolveCommandsOnPath(command: string): Promise<string[]> {
  if (commandListCache.has(command)) return commandListCache.get(command)!;
  const extnames = resolveExecutableExtensions();
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const entry of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of extnames) {
      const candidate = join(entry, `${command}${ext}`);
      if (seen.has(candidate) || !(await exists(candidate))) continue;
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

export async function resolveCommandOnPath(command: string): Promise<string | null> {
  if (commandCache.has(command)) return commandCache.get(command)!;
  const candidates = await resolveCommandsOnPath(command);
  const resolved = candidates.length > 0 ? candidates[0]! : null;
  commandCache.set(command, resolved);
  return resolved;
}

function resolveExecutableExtensions() {
  if (process.platform !== "win32") {
    return [""];
  }

  const configured = process.env.PATHEXT
    ?.split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured && configured.length > 0
    ? configured
    : [".EXE", ".CMD", ".BAT", ".COM"];
}
