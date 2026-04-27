import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfigDetailed, projectConfigPath, type ConfigLeaf, type ResolvedConfig } from "../lib/config";
import { printError, printJson, printLine } from "../lib/cli-output";

export async function configCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (command === "init") return configInit(args.slice(1));
  if (command === "validate") return configValidate(args.slice(1));
  if (command === "explain") return configExplain(args.slice(1));
  return configEffective(args);
}

function repoFromArgs(args: string[]): string {
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : process.cwd();
  if (repoIndex >= 0 && !repo) throw new Error("missing value for --repo");
  return repo;
}

function configEffective(args: string[]): void {
  const effective = args.includes("--effective");
  if (!effective) {
    throw new Error("wiki config requires a subcommand. Usage: wiki config --effective|init|validate|explain [--repo <path>]");
  }
  const json = args.includes("--json");
  const repo = repoFromArgs(args);

  const { config, warnings } = loadConfigDetailed(repo);
  for (const line of warnings) printError(line);

  if (json) {
    printJson(serialize(config));
    return;
  }
  printText(config);
}

function configInit(args: string[]): void {
  const repo = repoFromArgs(args);
  const path = projectConfigPath(repo);
  if (existsSync(path) && !args.includes("--force")) {
    throw new Error(`${path} already exists. Use --force to overwrite.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DEFAULT_CONFIG_FILE, "utf8");
  printLine(`wrote ${path}`);
}

function configValidate(args: string[]): void {
  const repo = repoFromArgs(args);
  const json = args.includes("--json");
  const { warnings } = loadConfigDetailed(repo);
  const result = { ok: true, path: projectConfigPath(repo), warnings };
  if (json) printJson(result);
  else {
    for (const line of warnings) printError(line);
    printLine(`wiki config validate: PASS (${result.path})`);
  }
}

function configExplain(args: string[]): void {
  const key = positionalArgs(args)[0];
  if (!key) throw new Error("missing config path. Usage: wiki config explain <path> [--repo <path>] [--json]");
  const repo = repoFromArgs(args);
  const json = args.includes("--json");
  const { config, warnings } = loadConfigDetailed(repo);
  for (const line of warnings) printError(line);
  const leaf = getLeaf(config, key);
  if (!leaf) throw new Error(`unknown config path: ${key}`);
  const result = { path: key, value: leaf.value, source: leaf.source };
  if (json) printJson(result);
  else printLine(`${key} = ${JSON.stringify(leaf.value)}  (source: ${leaf.source})`);
}

function positionalArgs(args: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo") {
      i++;
      continue;
    }
    if (arg.startsWith("--")) continue;
    values.push(arg);
  }
  return values;
}

function getLeaf(config: ResolvedConfig, key: string): ConfigLeaf<unknown> | undefined {
  if (key === "repo.ignore") return config.repo.ignore;
  if (key === "workflow.phaseSkills.research") return config.workflow.phaseSkills.research;
  if (key === "workflow.phaseSkills.domainModel") return config.workflow.phaseSkills.domainModel;
  if (key === "workflow.phaseSkills.prd") return config.workflow.phaseSkills.prd;
  if (key === "workflow.phaseSkills.slices") return config.workflow.phaseSkills.slices;
  if (key === "workflow.phaseSkills.tdd") return config.workflow.phaseSkills.tdd;
  if (key === "workflow.phaseSkills.verify") return config.workflow.phaseSkills.verify;
  return undefined;
}

const DEFAULT_CONFIG_FILE = `{
  "$schema": "./schemas/wiki.config.schema.json",
  "repo": {
    // Add project-specific repo scan exclusions here. Built-in generated/vendor
    // exclusions already cover node_modules, .venv, dist, build, coverage, etc.
    "ignore": []
  },
  "workflow": {
    "phaseSkills": {
      "research": "/research",
      "domainModel": "/domain-model",
      "prd": "/write-a-prd",
      "slices": "/prd-to-slices",
      "tdd": "/tdd",
      "verify": "/desloppify"
    }
  }
}
`;

function serialize(config: ResolvedConfig) {
  return {
    repo: {
      ignore: { value: config.repo.ignore.value, source: config.repo.ignore.source },
    },
    workflow: {
      phaseSkills: {
        research: { value: config.workflow.phaseSkills.research.value, source: config.workflow.phaseSkills.research.source },
        domainModel: { value: config.workflow.phaseSkills.domainModel.value, source: config.workflow.phaseSkills.domainModel.source },
        prd: { value: config.workflow.phaseSkills.prd.value, source: config.workflow.phaseSkills.prd.source },
        slices: { value: config.workflow.phaseSkills.slices.value, source: config.workflow.phaseSkills.slices.source },
        tdd: { value: config.workflow.phaseSkills.tdd.value, source: config.workflow.phaseSkills.tdd.source },
        verify: { value: config.workflow.phaseSkills.verify.value, source: config.workflow.phaseSkills.verify.source },
      },
    },
  };
}

function printText(config: ResolvedConfig): void {
  printLine("wiki config (effective):");
  const ignore = config.repo.ignore;
  const value = ignore.value.length ? `[${ignore.value.map((p) => JSON.stringify(p)).join(", ")}]` : "[]";
  printLine(`  repo.ignore = ${value}  (source: ${ignore.source})`);
  printLine(`  workflow.phaseSkills.research = ${JSON.stringify(config.workflow.phaseSkills.research.value)}  (source: ${config.workflow.phaseSkills.research.source})`);
  printLine(`  workflow.phaseSkills.domainModel = ${JSON.stringify(config.workflow.phaseSkills.domainModel.value)}  (source: ${config.workflow.phaseSkills.domainModel.source})`);
  printLine(`  workflow.phaseSkills.prd = ${JSON.stringify(config.workflow.phaseSkills.prd.value)}  (source: ${config.workflow.phaseSkills.prd.source})`);
  printLine(`  workflow.phaseSkills.slices = ${JSON.stringify(config.workflow.phaseSkills.slices.value)}  (source: ${config.workflow.phaseSkills.slices.source})`);
  printLine(`  workflow.phaseSkills.tdd = ${JSON.stringify(config.workflow.phaseSkills.tdd.value)}  (source: ${config.workflow.phaseSkills.tdd.source})`);
  printLine(`  workflow.phaseSkills.verify = ${JSON.stringify(config.workflow.phaseSkills.verify.value)}  (source: ${config.workflow.phaseSkills.verify.source})`);
}
