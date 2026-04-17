#!/usr/bin/env bun

import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

export const DEFAULT_BENCH_COMMANDS = [
  "update-index",
  "maintain",
  "discover",
  "doctor",
  "gate",
  "drift-check",
  "bind",
  "verify-page",
] as const;

const DEFAULT_REPO = "/Users/tothemoon/Dev/Code Forge/knowledge-wiki-system";
const DEFAULT_BIND_PAGE = "specs/slices/WIKI-FORGE-023/index.md";
const DEFAULT_BIND_SOURCE = "src/hierarchy/index-log.ts";
const DEFAULT_VERIFY_PAGE = "specs/slices/WIKI-FORGE-023/index.md";

type BenchName = typeof DEFAULT_BENCH_COMMANDS[number];

type BenchSpec = {
  name: BenchName;
  label: string;
  mutates: boolean;
  args: (options: Options, baseRef: string) => string[];
};

type BenchSuite = {
  label: string;
  samplesMs: number[];
};

type BenchResult = {
  label: string;
  runs: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  mean_ms: number;
  min_ms: number;
  max_ms: number;
};

type Options = {
  vault: string;
  project: string;
  repo: string;
  base: string;
  iterations: number;
  keepTemp: boolean;
  commands: BenchName[];
  bindPage: string;
  bindSource: string;
  verifyPage: string;
};

const repoRoot = resolve(import.meta.dir, "..");

const BENCH_SPECS: Record<BenchName, BenchSpec> = {
  "update-index": {
    name: "update-index",
    label: "wiki update-index --write",
    mutates: true,
    args: (options) => ["update-index", options.project, "--write"],
  },
  maintain: {
    name: "maintain",
    label: "wiki maintain",
    mutates: false,
    args: (options, baseRef) => ["maintain", options.project, "--repo", options.repo, "--base", baseRef],
  },
  discover: {
    name: "discover",
    label: "wiki discover",
    mutates: false,
    args: (options) => ["discover", options.project, "--repo", options.repo],
  },
  doctor: {
    name: "doctor",
    label: "wiki doctor",
    mutates: false,
    args: (options, baseRef) => ["doctor", options.project, "--repo", options.repo, "--base", baseRef],
  },
  gate: {
    name: "gate",
    label: "wiki gate",
    mutates: false,
    args: (options, baseRef) => ["gate", options.project, "--repo", options.repo, "--base", baseRef],
  },
  "drift-check": {
    name: "drift-check",
    label: "wiki drift-check --show-unbound",
    mutates: false,
    args: (options) => ["drift-check", options.project, "--repo", options.repo, "--show-unbound"],
  },
  bind: {
    name: "bind",
    label: "wiki bind --dry-run",
    mutates: false,
    args: (options) => ["bind", options.project, options.bindPage, options.bindSource, "--dry-run"],
  },
  "verify-page": {
    name: "verify-page",
    label: "wiki verify-page --dry-run",
    mutates: false,
    args: (options) => ["verify-page", options.project, options.verifyPage, "code-verified", "--dry-run"],
  },
};

if (import.meta.main) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = mkdtempSync(join(tmpdir(), "wiki-forge-maint-bench-"));
  const outputPath = join(tempRoot, `wiki-maintenance-bench-${Date.now().toString(36)}.json`);

  try {
    const suites: BenchSuite[] = [];
    for (const name of options.commands) {
      const spec = BENCH_SPECS[name];
      suites.push(...await measureCommand(spec, options));
    }

    const results = suites.map(toBenchResult);
    const payload = {
      project: options.project,
      vault: options.vault,
      repo: options.repo,
      base: options.base,
      iterations: options.iterations,
      commands: options.commands,
      results,
    };

    await Bun.write(outputPath, JSON.stringify(payload, null, 2));
    printResults(options, results, outputPath, tempRoot);
  } finally {
    if (!options.keepTemp) rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function measureCommand(spec: BenchSpec, options: Options): Promise<BenchSuite[]> {
  const cold = await measureSuite(`${spec.label} cold`, options.iterations, async () => {
    const workspace = createWorkspace(options);
    try {
      runSpec(spec, workspace, true);
    } finally {
      cleanupWorkspace(workspace.root);
    }
  });

  const workspace = createWorkspace(options);
  try {
    runSpec(spec, workspace, true);
    const warm = await measureSuite(`${spec.label} warm`, options.iterations, async () => {
      runSpec(spec, workspace, false);
    });
    return [cold, warm];
  } finally {
    cleanupWorkspace(workspace.root);
  }
}

async function measureSuite(label: string, runs: number, runner: () => void | Promise<void>) {
  const samplesMs: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await runner();
    samplesMs.push(performance.now() - started);
  }
  return { label, samplesMs } satisfies BenchSuite;
}

function runSpec(spec: BenchSpec, workspace: Workspace, clearCacheFirst: boolean) {
  if (spec.mutates) resetWorkspaceState(workspace);
  if (clearCacheFirst) clearWikiCache(workspace.vault);
  const args = spec.args({ ...workspace.options, repo: workspace.repo }, workspace.baseRef);
  runWiki(args, { KNOWLEDGE_VAULT_ROOT: workspace.vault });
}

type Workspace = {
  root: string;
  vault: string;
  repo: string;
  baseRef: string;
  options: Options;
};

function createWorkspace(options: Options): Workspace {
  const root = mkdtempSync(join(tmpdir(), "wiki-forge-bench-run-"));
  const vault = join(root, "Knowledge");
  const repo = join(root, "repo");
  cloneDir(options.vault, vault, [".git", ".cache"]);
  cloneDir(options.repo, repo, ["node_modules", ".git"]);
  copyGitDir(options.repo, repo);
  const baseRef = resolveBaseRef(repo, options.base);
  return { root, vault, repo, baseRef, options: { ...options, repo } };
}

function resetWorkspaceState(workspace: Workspace) {
  cloneDir(workspace.options.vault, workspace.vault, [".git", ".cache"]);
}

function cleanupWorkspace(root: string) {
  rmSync(root, { recursive: true, force: true });
}

function cloneDir(source: string, target: string, excludes: string[] = []) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const name = path.split(/[/\\]/u).pop() || "";
      return !excludes.includes(name);
    },
  });
}

function copyGitDir(sourceRepo: string, targetRepo: string) {
  const sourceGit = join(sourceRepo, ".git");
  const targetGit = join(targetRepo, ".git");
  if (!existsSync(sourceGit)) throw new Error(`repo is missing .git: ${sourceRepo}`);
  cpSync(sourceGit, targetGit, { recursive: true });
}

function resolveBaseRef(repo: string, base: string) {
  const proc = Bun.spawnSync(["git", "rev-parse", base], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || `git rev-parse ${base} failed`);
  return proc.stdout.toString().trim();
}

function clearWikiCache(vault: string) {
  rmSync(join(vault, ".cache", "wiki-cli"), { recursive: true, force: true });
}

function runWiki(args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed\n${proc.stderr.toString() || proc.stdout.toString()}`.trim());
  }
}

function toBenchResult(suite: BenchSuite) {
  const sorted = [...suite.samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    label: suite.label,
    runs: sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    mean_ms: sorted.length ? sum / sorted.length : 0,
    min_ms: sorted[0] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
  } satisfies BenchResult;
}

function percentile(sorted: number[], value: number) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[index];
}

function printResults(options: Options, results: BenchResult[], jsonPath: string, tempRoot: string) {
  console.log(`vault: ${options.vault}`);
  console.log(`repo: ${options.repo}`);
  console.log(`base: ${options.base}`);
  console.log(`iterations: ${options.iterations}`);
  console.log(`commands: ${options.commands.join(", ")}`);
  console.log("");
  console.log("| Benchmark | p50 ms | p95 ms | p99 ms | mean ms | min ms | max ms |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    console.log(`| ${result.label} | ${format(result.p50_ms)} | ${format(result.p95_ms)} | ${format(result.p99_ms)} | ${format(result.mean_ms)} | ${format(result.min_ms)} | ${format(result.max_ms)} |`);
  }
  console.log("");
  console.log(`json: ${jsonPath}`);
  if (options.keepTemp) console.log(`temp root: ${tempRoot}`);
}

function format(value: number) {
  return value.toFixed(1);
}

function parseArgs(args: string[]): Options {
  const defaults: Options = {
    vault: process.env.KNOWLEDGE_VAULT_ROOT?.trim() || join(homedir(), "Knowledge"),
    project: "wiki-forge",
    repo: DEFAULT_REPO,
    base: "HEAD~1",
    iterations: 5,
    keepTemp: false,
    commands: [...DEFAULT_BENCH_COMMANDS],
    bindPage: DEFAULT_BIND_PAGE,
    bindSource: DEFAULT_BIND_SOURCE,
    verifyPage: DEFAULT_VERIFY_PAGE,
  };

  const values = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--vault") values.vault = resolve(requireValue(args[index + 1], arg));
    else if (arg === "--project") values.project = requireValue(args[index + 1], arg);
    else if (arg === "--repo") values.repo = resolve(requireValue(args[index + 1], arg));
    else if (arg === "--base") values.base = requireValue(args[index + 1], arg);
    else if (arg === "--iterations") values.iterations = parsePositiveInteger(requireValue(args[index + 1], arg), arg);
    else if (arg === "--commands") values.commands = parseCommandList(requireValue(args[index + 1], arg));
    else if (arg === "--bind-page") values.bindPage = requireValue(args[index + 1], arg);
    else if (arg === "--bind-source") values.bindSource = requireValue(args[index + 1], arg);
    else if (arg === "--verify-page") values.verifyPage = requireValue(args[index + 1], arg);
    else if (arg === "--keep-temp") { values.keepTemp = true; continue; }
    else throw new Error(`unknown arg: ${arg}`);
    index += 1;
  }

  return values;
}

function requireValue(value: string | undefined, label: string) {
  if (!value) throw new Error(`missing ${label} value`);
  return value;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}: ${value}`);
  return parsed;
}

export function parseCommandList(value: string): BenchName[] {
  const names = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!names.length) throw new Error("invalid --commands: empty list");
  const normalized = names.map((name) => {
    if (!Object.hasOwn(BENCH_SPECS, name)) throw new Error(`unknown benchmark command: ${name}`);
    return name as BenchName;
  });
  return normalized.filter((name, index, values) => values.indexOf(name) === index);
}

