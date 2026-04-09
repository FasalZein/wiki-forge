import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QMD_NODE_CLI, VAULT_ROOT } from "../constants";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";
import { resolveCommandOnPath } from "./runtime";

const QMD_CACHE_VERSION = "1";
const QMD_INDEX_PATH = join(homedir(), ".cache", "qmd", "index.sqlite");

type QmdCapture = {
  stdout: string;
  stderr: string;
};

let qmdAvailable: boolean | null = null;

export async function runQmd(args: string[]) {
  const proc = Bun.spawn(qmdInvocation(args), {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`qmd ${args[0]} failed with exit code ${code}`);
  }
}

export async function runQmdCached(args: string[], cacheKey: string) {
  const cached = await readCache<QmdCapture>("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    if (cached.stderr) process.stderr.write(cached.stderr);
    if (cached.stdout) process.stdout.write(cached.stdout);
    return;
  }

  const capture = await captureQmd(args);
  await writeCache("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
  if (capture.stderr) process.stderr.write(capture.stderr);
  if (capture.stdout) process.stdout.write(capture.stdout);
}

export async function captureQmd(args: string[]) {
  const proc = Bun.spawn(qmdInvocation(args), {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`qmd ${args[0]} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
  }

  return { stdout, stderr };
}

export async function captureQmdJsonCached(args: string[], cacheKey: string) {
  const cached = await readCache<QmdCapture>("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    return parseQmdJson(cached.stdout);
  }

  const capture = await captureQmd(args);
  await writeCache("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
  return parseQmdJson(capture.stdout);
}

export function buildStructuredHybridQuery(query: string) {
  return `lex: ${query}\nvec: ${query}`;
}

export async function searchKnowledge(query: string, options?: { hybrid?: boolean; writeOutput?: boolean }) {
  assertQmdAvailable();
  const hybrid = options?.hybrid ?? false;
  const args = hybrid
    ? ["query", buildStructuredHybridQuery(query), "-c", "knowledge"]
    : ["search", query, "-c", "knowledge"];
  const cacheKey = hybrid ? `search:hybrid:${query}` : `search:${query}`;
  if (options?.writeOutput === false) return captureQmd(args);
  await runQmdCached(args, cacheKey);
}

export async function queryKnowledge(query: string, options: { expand?: boolean; json: true; maxResults?: number; cacheKeyPrefix?: string; }): Promise<QmdResult[]>;
export async function queryKnowledge(query: string, options?: { expand?: boolean; json?: false; maxResults?: number; cacheKeyPrefix?: string; }): Promise<void>;
export async function queryKnowledge(query: string, options?: { expand?: boolean; json?: boolean; maxResults?: number; cacheKeyPrefix?: string; }): Promise<QmdResult[] | void> {
  assertQmdAvailable();
  const expand = options?.expand ?? false;
  const commandArgs = ["query", expand ? query : buildStructuredHybridQuery(query), "-c", "knowledge"];
  if (options?.json) commandArgs.push("--json");
  if (typeof options?.maxResults === "number") commandArgs.push("-n", String(options.maxResults));
  const cachePrefix = options?.cacheKeyPrefix ?? "query";
  const cacheKey = `${cachePrefix}:${expand ? "expand" : "structured"}:${query}:${options?.maxResults ?? "default"}:${options?.json ? "json" : "text"}`;
  if (options?.json) return captureQmdJsonCached(commandArgs, cacheKey);
  await runQmdCached(commandArgs, cacheKey);
}

export async function ensureKnowledgeCollection() {
  assertQmdAvailable();
  const list = await captureQmd(["collection", "list"]);
  if (!list.stdout.includes("knowledge")) {
    await runQmd(["collection", "add", VAULT_ROOT, "--name", "knowledge", "--mask", "**/*.md"]);
  }

  const contexts = await captureQmd(["context", "list"]);
  if (!contexts.stdout.includes("Knowledge vault: projects, wiki, research")) {
    await runQmd(["context", "add", "qmd://knowledge", "Knowledge vault: projects, wiki, research"]);
  }
  if (!contexts.stdout.includes("Use index.md first, then _summary.md, then drill deeper.")) {
    await runQmd(["context", "add", "/", "Use index.md first, then _summary.md, then drill deeper."]);
  }
}

function qmdInvocation(args: string[]) {
  if (existsSync(QMD_NODE_CLI)) {
    return ["node", QMD_NODE_CLI, ...args];
  }
  return ["qmd", ...args];
}

export function assertQmdAvailable() {
  if (qmdAvailable === true) return;
  if (existsSync(QMD_NODE_CLI)) {
    qmdAvailable = true;
    return;
  }
  if (resolveCommandOnPath("qmd")) {
    qmdAvailable = true;
    return;
  }
  qmdAvailable = false;
  throw new Error(
    "qmd not found. Retrieval commands (search, query, ask) require qmd.\n" +
      "Install qmd, then run 'wiki qmd-setup'.\n" +
      "Or set QMD_NODE_CLI to your qmd.js path.",
  );
}

function qmdFingerprint() {
  return fileFingerprint(QMD_INDEX_PATH);
}

function parseQmdJson(stdout: string) {
  try {
    return JSON.parse(stdout) as QmdResult[];
  } catch (error) {
    throw new Error(`unable to parse qmd JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}
