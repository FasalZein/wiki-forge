#!/usr/bin/env bun

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { buildStructuredHybridQuery } from "../src/lib/qmd";

export const DEFAULT_CANDIDATE_LIMITS = [8, 16, 40] as const;

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
  min_ms: number;
  max_ms: number;
  mean_ms: number;
};

type Options = {
  vault: string;
  project: string;
  query: string;
  askQuestion: string;
  generalQuery: string;
  generalAskQuestion: string;
  rationaleQuery: string;
  rationaleAskQuestion: string;
  topic: string;
  iterations: number;
  indexName: string;
  keepTemp: boolean;
  candidateLimits: number[];
};

const repoRoot = resolve(import.meta.dir, "..");

if (import.meta.main) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = mkdtempSync(join(tmpdir(), "wiki-forge-qmd-bench-"));
  const tempVault = join(tempRoot, "Knowledge");
  const sourceDir = join(tempRoot, "sources");
  const outputPath = join(tempRoot, `qmd-bench-${Date.now().toString(36)}.json`);

  mkdirSync(tempVault, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  copyMarkdownVault(options.vault, tempVault);

  const benchEnv = {
    ...process.env,
    KNOWLEDGE_VAULT_ROOT: tempVault,
    QMD_INDEX_NAME: options.indexName,
  };

  try {
    runCommand(["bun", "src/index.ts", "qmd-setup"], { env: benchEnv, cwd: repoRoot });

    const suites: BenchSuite[] = [];
    suites.push(await measureSuite("qmd update", options.iterations, () => runQmd(options, ["update"])));
    suites.push(await measureSuite("qmd embed", options.iterations, () => runQmd(options, ["embed"])));
    suites.push(await measureSuite("qmd search (bm25)", options.iterations, () => runQmd(options, ["search", options.query, "-c", "knowledge", "--json", "-n", "10"]))); 
    suites.push(await measureSuite("qmd vsearch (vector)", options.iterations, () => runQmd(options, ["vsearch", options.query, "-c", "knowledge", "--json", "-n", "10"])));
    suites.push(await measureSuite("qmd query (expand)", options.iterations, () => runQmd(options, ["query", options.query, "-c", "knowledge", "--json", "-n", "10"])));
    for (const limit of options.candidateLimits) {
      suites.push(await measureSuite(`qmd query (structured, -C ${limit})`, options.iterations, () => runQmd(options, ["query", buildStructuredHybridQuery(options.query), "-c", "knowledge", "--json", "-n", "10", "-C", String(limit)])));
    }
    suites.push(...await measureColdWarmSuite("wiki query (structural)", options.iterations, () => runWiki(benchEnv, ["query", options.query]), () => clearWikiCache(tempVault)));
    suites.push(...await measureColdWarmSuite("wiki ask (structural)", options.iterations, () => runWiki(benchEnv, ["ask", options.project, options.askQuestion]), () => clearWikiCache(tempVault)));
    suites.push(...await measureColdWarmSuite("wiki query (general)", options.iterations, () => runWiki(benchEnv, ["query", options.generalQuery]), () => clearWikiCache(tempVault)));
    suites.push(...await measureColdWarmSuite("wiki ask (general)", options.iterations, () => runWiki(benchEnv, ["ask", options.project, options.generalAskQuestion]), () => clearWikiCache(tempVault)));
    suites.push(...await measureColdWarmSuite("wiki query (rationale)", options.iterations, () => runWiki(benchEnv, ["query", options.rationaleQuery]), () => clearWikiCache(tempVault)));
    suites.push(...await measureColdWarmSuite("wiki ask (rationale)", options.iterations, () => runWiki(benchEnv, ["ask", options.project, options.rationaleAskQuestion]), () => clearWikiCache(tempVault)));
    suites.push(await measureSuite("ingest -> qmd update -> qmd embed", options.iterations, (run) => runPipeline(run, options, benchEnv, tempVault, sourceDir)));

    const results = suites.map(toBenchResult);
    const payload = {
      vault: options.vault,
      tempVault,
      indexName: options.indexName,
      project: options.project,
      topic: options.topic,
      query: options.query,
      askQuestion: options.askQuestion,
      generalQuery: options.generalQuery,
      generalAskQuestion: options.generalAskQuestion,
      rationaleQuery: options.rationaleQuery,
      rationaleAskQuestion: options.rationaleAskQuestion,
      iterations: options.iterations,
      candidateLimits: options.candidateLimits,
      results,
    };

    writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
    printResults(options, results, outputPath, tempRoot, tempVault);
  } finally {
    if (!options.keepTemp) rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function measureSuite(label: string, runs: number, runner: (run: number) => void | Promise<void>) {
  const samplesMs: number[] = [];
  for (let run = 1; run <= runs; run += 1) {
    const started = performance.now();
    await runner(run);
    samplesMs.push(performance.now() - started);
  }
  return { label, samplesMs } satisfies BenchSuite;
}

async function measureColdWarmSuite(label: string, runs: number, runner: () => void | Promise<void>, reset: () => void | Promise<void>): Promise<BenchSuite[]> {
  const cold = await measureSuite(`${label} cold`, runs, async () => {
    await reset();
    await runner();
  });
  await reset();
  await runner();
  const warm = await measureSuite(`${label} warm`, runs, async () => {
    await runner();
  });
  return [cold, warm];
}

async function runPipeline(run: number, options: Options, benchEnv: NodeJS.ProcessEnv, tempVault: string, sourceDir: string) {
  const sourceName = `bench-source-${run}.txt`;
  const sourcePath = join(sourceDir, sourceName);
  writeFileSync(sourcePath, [`# QMD bench source ${run}`, "", "- Measure ingest latency.", "- Measure qmd update latency.", "- Measure qmd embed latency.", ""].join("\n"), "utf8");

  try {
    runWiki(benchEnv, ["source", "ingest", sourcePath, "--topic", options.topic]);
    runQmd(options, ["update"]);
    runQmd(options, ["embed"]);
  } finally {
    cleanupPipelineArtifacts(sourceName, options, tempVault);
    runQmd(options, ["update"]);
    runQmd(options, ["embed"]);
    if (existsSync(sourcePath)) unlinkSync(sourcePath);
  }
}

function cleanupPipelineArtifacts(sourceName: string, options: Options, tempVault: string) {
  const slug = slugify(sourceName.replace(/\.[^.]+$/u, ""));
  const rawPath = join(tempVault, "raw", "conversations", sourceName);
  const researchPath = join(tempVault, "research", ...options.topic.split("/"), `${slug}.md`);
  if (existsSync(rawPath)) unlinkSync(rawPath);
  if (existsSync(researchPath)) unlinkSync(researchPath);
}

function clearWikiCache(vault: string) {
  rmSync(join(vault, ".cache", "wiki-cli"), { recursive: true, force: true });
}

function runWiki(benchEnv: NodeJS.ProcessEnv, args: string[]) {
  runCommand(["bun", "src/index.ts", ...args], { env: benchEnv, cwd: repoRoot });
}

function runQmd(options: Options, args: string[]) {
  runCommand(["qmd", "--index", options.indexName, ...args], { cwd: repoRoot, env: process.env });
}

function runCommand(cmd: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
  const proc = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed\n${proc.stderr.toString() || proc.stdout.toString()}`.trim());
  }
}

function toBenchResult(suite: BenchSuite) {
  const sorted = [...suite.samplesMs].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    label: suite.label,
    runs: sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    min_ms: sorted[0] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
    mean_ms: sorted.length ? sum / sorted.length : 0,
  } satisfies BenchResult;
}

function percentile(sorted: number[], value: number) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[index];
}

function printResults(options: Options, results: BenchResult[], jsonPath: string, tempPath: string, tempVault: string) {
  console.log(`vault: ${options.vault}`);
  console.log(`temp vault: ${tempVault}`);
  console.log(`index: ${options.indexName}`);
  console.log(`iterations: ${options.iterations}`);
  console.log(`candidate limits: ${options.candidateLimits.join(", ")}`);
  console.log(`structural query: ${options.query}`);
  console.log(`structural ask: ${options.askQuestion}`);
  console.log(`general query: ${options.generalQuery}`);
  console.log(`general ask: ${options.generalAskQuestion}`);
  console.log(`rationale query: ${options.rationaleQuery}`);
  console.log(`rationale ask: ${options.rationaleAskQuestion}`);
  console.log("");
  console.log("| Benchmark | p50 ms | p95 ms | p99 ms | mean ms | min ms | max ms |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    console.log(`| ${result.label} | ${format(result.p50_ms)} | ${format(result.p95_ms)} | ${format(result.p99_ms)} | ${format(result.mean_ms)} | ${format(result.min_ms)} | ${format(result.max_ms)} |`);
  }
  console.log("");
  console.log(`json: ${jsonPath}`);
  if (options.keepTemp) console.log(`temp root: ${tempPath}`);
}

function format(value: number) {
  return value.toFixed(1);
}

function parseArgs(args: string[]): Options {
  const defaults = {
    vault: process.env.KNOWLEDGE_VAULT_ROOT?.trim() || join(homedir(), "Knowledge"),
    project: "wiki-forge",
    query: "where do PRDs live",
    askQuestion: "where do slice docs live",
    generalQuery: "how does verification work",
    generalAskQuestion: "how does the wiki verification flow work",
    rationaleQuery: "why did we choose task-based spec folders",
    rationaleAskQuestion: "why did we choose task-based spec folders over flat files",
    topic: "projects/wiki-forge/bench",
    iterations: 9,
    indexName: `wiki-forge-bench-${Date.now().toString(36)}`,
    keepTemp: false,
    candidateLimits: [...DEFAULT_CANDIDATE_LIMITS],
  } satisfies Options;

  const values = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--vault") values.vault = resolve(requireValue(args[index + 1], arg));
    else if (arg === "--project") values.project = requireValue(args[index + 1], arg);
    else if (arg === "--query") values.query = requireValue(args[index + 1], arg);
    else if (arg === "--ask") values.askQuestion = requireValue(args[index + 1], arg);
    else if (arg === "--topic") values.topic = requireValue(args[index + 1], arg);
    else if (arg === "--iterations") values.iterations = parsePositiveInteger(requireValue(args[index + 1], arg), arg);
    else if (arg === "--index-name") values.indexName = requireValue(args[index + 1], arg);
    else if (arg === "--general-query") values.generalQuery = requireValue(args[index + 1], arg);
    else if (arg === "--general-ask") values.generalAskQuestion = requireValue(args[index + 1], arg);
    else if (arg === "--rationale-query") values.rationaleQuery = requireValue(args[index + 1], arg);
    else if (arg === "--rationale-ask") values.rationaleAskQuestion = requireValue(args[index + 1], arg);
    else if (arg === "--candidate-limits") values.candidateLimits = parseCandidateLimitsArg(requireValue(args[index + 1], arg));
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

export function parseCandidateLimitsArg(value: string) {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parsePositiveInteger(entry, "--candidate-limits"));
  if (!parsed.length) throw new Error("invalid --candidate-limits: empty list");
  return parsed.filter((entry, index, values) => values.indexOf(entry) === index).sort((left, right) => left - right);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "source";
}

function copyMarkdownVault(source: string, target: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".cache") continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyMarkdownTree(sourcePath, targetPath);
      continue;
    }
    if (entry.name.endsWith(".md")) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyMarkdownTree(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".cache") continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyMarkdownTree(sourcePath, targetPath);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const stats = statSync(sourcePath);
    if (!stats.isFile()) continue;
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}
