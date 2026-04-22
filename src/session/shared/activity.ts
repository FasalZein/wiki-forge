import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { ensureDir } from "../../lib/fs";

export type ActivityEntry = {
  ts: string;
  sid: string;
  cmd: string;
  project?: string;
  target?: string;
  agent?: string;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export type SessionSummary = {
  sessionId: string | null;
  totalCommands: number;
  durationMinutes: number;
  commandCounts: Record<string, number>;
  sliceTransitions: Array<{ cmd: string; target: string; ok: boolean }>;
  errors: Array<{ cmd: string; error: string; target?: string }>;
};

const MAX_BYTES = 512 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_FALLBACK_WINDOW_MS = 4 * 60 * 60 * 1000;

const SLICE_COMMANDS = new Set(["claim", "start-slice", "verify-slice", "close-slice", "forge:start", "forge:open", "forge:check", "forge:close", "forge:status"]);

const NO_PROJECT_COMMANDS = new Set([
  "help", "cache-clear", "log", "obsidian", "setup-shell", "lint-vault",
  "search", "query", "qmd-status", "qmd-update", "qmd-embed", "qmd-setup",
  "scaffold-layer", "create-layer-page", "migrate-verification", "bind",
  "drift-check", "verify-page", "update-index", "pipeline",
  "research:scaffold", "research:status", "research:ingest", "research:lint", "research:audit",
  "source:ingest",
]);

const TARGET_COMMANDS = new Set([...SLICE_COMMANDS, "export-prompt"]);

// --- path helpers ---

function projectActivityPath(project: string): string {
  return join(VAULT_ROOT, "projects", project, ".activity.jsonl");
}

// --- public sync functions (called from index.ts finally block) ---

function readEnvTrimmed(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return;
}

export function resolveSessionId(): string {
  return readEnvTrimmed("WIKI_SESSION_ID") || `${process.ppid}-${new Date().toISOString().slice(0, 10)}`;
}

export function resolveAgent(): string | undefined {
  return readEnvTrimmed("WIKI_AGENT_NAME", "CLAUDE_AGENT_NAME", "USER");
}

export function extractProject(cmd: string, args: string[]): string | undefined {
  if (NO_PROJECT_COMMANDS.has(cmd)) return undefined;
  const candidate = args.find((a) => !a.startsWith("-"));
  if (!candidate || candidate.includes("/") || /^\d/.test(candidate)) return undefined;
  return candidate;
}

export function extractTarget(cmd: string, args: string[]): string | undefined {
  if (!TARGET_COMMANDS.has(cmd)) return undefined;
  const positional = args.filter((a) => !a.startsWith("-"));
  return positional[1] || undefined;
}

export function appendActivity(entry: ActivityEntry): void {
  if (!entry.project) return; // skip non-project commands — nothing to scope to
  try {
    const path = projectActivityPath(entry.project);
    ensureDir(dirname(path));
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
    void pruneIfNeeded(path);
  } catch {
    // tracker is best-effort — never crash the CLI
  }
}

// --- public async functions (called from handover/resume) ---

export async function readActivity(project: string): Promise<ActivityEntry[]> {
  const path = projectActivityPath(project);
  if (!existsSync(path)) return [];
  const text = await Bun.file(path).text();
  const entries: ActivityEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof parsed.ts === "string" && typeof parsed.cmd === "string") {
        entries.push(parsed as ActivityEntry);
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export async function collectSessionActivity(
  project: string,
  sessionId?: string,
): Promise<SessionSummary> {
  const all = await readActivity(project);
  const cutoff = Date.now() - SESSION_FALLBACK_WINDOW_MS;

  const filtered = all.filter((e) => {
    if (sessionId) return e.sid === sessionId;
    return new Date(e.ts).getTime() > cutoff;
  });

  const commandCounts: Record<string, number> = {};
  const sliceTransitions: SessionSummary["sliceTransitions"] = [];
  const errors: SessionSummary["errors"] = [];
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const entry of filtered) {
    commandCounts[entry.cmd] = (commandCounts[entry.cmd] || 0) + 1;

    if (SLICE_COMMANDS.has(entry.cmd) && entry.target) {
      sliceTransitions.push({ cmd: entry.cmd, target: entry.target, ok: entry.ok });
    }

    if (!entry.ok && entry.error) {
      errors.push({ cmd: entry.cmd, error: entry.error, ...(entry.target ? { target: entry.target } : {}) });
    }

    const ms = new Date(entry.ts).getTime();
    if (Number.isFinite(ms)) {
      if (firstTs === null || ms < firstTs) firstTs = ms;
      if (lastTs === null || ms > lastTs) lastTs = ms;
    }
  }

  const durationMinutes = firstTs !== null && lastTs !== null
    ? Math.round((lastTs - firstTs) / 60_000)
    : 0;

  return {
    sessionId: sessionId || (filtered.length > 0 ? filtered[0].sid : null),
    totalCommands: filtered.length,
    durationMinutes,
    commandCounts,
    sliceTransitions,
    errors,
  };
}

// --- internal ---

async function pruneIfNeeded(path: string): Promise<void> {
  try {
    const file = Bun.file(path);
    if (file.size < MAX_BYTES) return;
    const cutoff = Date.now() - MAX_AGE_MS;
    const text = await file.text();
    const kept = text.split("\n").filter((line) => {
      if (!line.trim()) return false;
      try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || typeof parsed.ts !== "string") return false;
        return new Date(parsed.ts).getTime() > cutoff;
      } catch {
        return false;
      }
    });
    await Bun.write(path, kept.join("\n") + "\n");
  } catch {
    // prune is best-effort
  }
}
