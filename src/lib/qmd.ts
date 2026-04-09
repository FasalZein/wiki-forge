import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QMD_NODE_CLI } from "../constants";
import type { QmdResult } from "../types";
import { fileFingerprint, readCache, writeCache } from "./cache";

const QMD_CACHE_VERSION = "1";
const QMD_INDEX_PATH = join(homedir(), ".cache", "qmd", "index.sqlite");

type QmdCapture = {
  stdout: string;
  stderr: string;
};

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
  const cached = readCache<QmdCapture>("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    if (cached.stderr) process.stderr.write(cached.stderr);
    if (cached.stdout) process.stdout.write(cached.stdout);
    return;
  }

  const capture = await captureQmd(args);
  writeCache("qmd-output", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
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
  const cached = readCache<QmdCapture>("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint());
  if (cached) {
    return parseQmdJson(cached.stdout);
  }

  const capture = await captureQmd(args);
  writeCache("qmd-json", cacheKey, QMD_CACHE_VERSION, qmdFingerprint(), capture);
  return parseQmdJson(capture.stdout);
}

export function buildStructuredHybridQuery(query: string) {
  return `lex: ${query}\nvec: ${query}`;
}

function qmdInvocation(args: string[]) {
  if (existsSync(QMD_NODE_CLI)) {
    return ["node", QMD_NODE_CLI, ...args];
  }
  return ["qmd", ...args];
}

export function assertQmdAvailable() {
  if (existsSync(QMD_NODE_CLI)) return;
  try {
    const result = Bun.spawnSync(["which", "qmd"], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) return;
  } catch {}
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
