import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { printError } from "../cli-output";
type ForgePhase = "research" | "domain-model" | "prd" | "slices" | "tdd" | "verify";

export type ConfigSource = "default" | "system" | "project";

export interface ConfigLeaf<T> {
  value: T;
  source: ConfigSource;
}

export interface ResolvedConfig {
  repo: {
    ignore: ConfigLeaf<string[]>;
  };
  workflow: {
    phaseSkills: {
      research: ConfigLeaf<string>;
      domainModel: ConfigLeaf<string>;
      prd: ConfigLeaf<string>;
      slices: ConfigLeaf<string>;
      tdd: ConfigLeaf<string>;
      verify: ConfigLeaf<string>;
    };
  };
}

export interface LoadConfigResult {
  config: ResolvedConfig;
  warnings: string[];
}

export class WikiConfigError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = "WikiConfigError";
  }
}

const KNOWN_LEAF_PATHS = new Set([
  "repo.ignore",
  "workflow.phaseSkills.research",
  "workflow.phaseSkills.domainModel",
  "workflow.phaseSkills.prd",
  "workflow.phaseSkills.slices",
  "workflow.phaseSkills.tdd",
  "workflow.phaseSkills.verify",
]);

const DEFAULT_CONFIG: ResolvedConfig = {
  repo: {
    ignore: { value: [], source: "default" },
  },
  workflow: {
    phaseSkills: {
      research: { value: "/research", source: "default" },
      domainModel: { value: "/domain-model", source: "default" },
      prd: { value: "/write-a-prd", source: "default" },
      slices: { value: "/prd-to-slices", source: "default" },
      tdd: { value: "/tdd", source: "default" },
      verify: { value: "/desloppify", source: "default" },
    },
  },
};

function defaultConfig(): ResolvedConfig {
  return {
    repo: {
      ignore: { value: [...DEFAULT_CONFIG.repo.ignore.value], source: "default" },
    },
    workflow: {
      phaseSkills: {
        research: { value: DEFAULT_CONFIG.workflow.phaseSkills.research.value, source: "default" },
        domainModel: { value: DEFAULT_CONFIG.workflow.phaseSkills.domainModel.value, source: "default" },
        prd: { value: DEFAULT_CONFIG.workflow.phaseSkills.prd.value, source: "default" },
        slices: { value: DEFAULT_CONFIG.workflow.phaseSkills.slices.value, source: "default" },
        tdd: { value: DEFAULT_CONFIG.workflow.phaseSkills.tdd.value, source: "default" },
        verify: { value: DEFAULT_CONFIG.workflow.phaseSkills.verify.value, source: "default" },
      },
    },
  };
}

export function systemConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, ".config", "wiki-forge", "config.jsonc");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, "wiki.config.jsonc");
}

export function loadConfigDetailed(cwd: string, homeDir: string = homedir()): LoadConfigResult {
  const config = defaultConfig();
  const warnings: string[] = [];

  const systemPath = systemConfigPath(homeDir);
  if (existsSync(systemPath)) {
    const raw = readLayerFile(systemPath);
    applyLayer(config, raw, "system", systemPath, warnings);
  }

  const projectPath = projectConfigPath(cwd);
  if (existsSync(projectPath)) {
    const raw = readLayerFile(projectPath);
    applyLayer(config, raw, "project", projectPath, warnings);
  }

  return { config, warnings };
}

export function loadConfig(cwd: string, homeDir: string = homedir()): ResolvedConfig {
  const { config, warnings } = loadConfigDetailed(cwd, homeDir);
  for (const line of warnings) printError(line);
  return config;
}

function readLayerFile(absolutePath: string): unknown {
  const text = readFileSync(absolutePath, "utf8");
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const first = errors[0];
    const { line, column } = offsetToLineCol(text, first.offset);
    const code = printParseErrorCode(first.error);
    throw new WikiConfigError(`parse error in ${absolutePath}: ${code} at line ${line}, column ${column}`);
  }
  return parsed;
}

function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function applyLayer(
  config: ResolvedConfig,
  raw: unknown,
  source: Exclude<ConfigSource, "default">,
  filePath: string,
  warnings: string[],
): void {
  if (!isPlainObject(raw)) {
    throw new WikiConfigError(`invalid config in ${filePath}: root must be an object`);
  }
  walkLayer(raw, "", (path, value) => {
    if (path === "repo.ignore") {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new WikiConfigError(
          `invalid config in ${filePath}: key 'repo.ignore' expected type 'string[]'`,
        );
      }
      config.repo.ignore = { value: value as string[], source };
      return;
    }
    if (path.startsWith("workflow.phaseSkills.")) {
      if (typeof value !== "string") {
        throw new WikiConfigError(
          `invalid config in ${filePath}: key '${path}' expected type 'string'`,
        );
      }
      const key = path.slice("workflow.phaseSkills.".length);
      if (key === "research" || key === "domainModel" || key === "prd" || key === "slices" || key === "tdd" || key === "verify") {
        config.workflow.phaseSkills[key] = { value, source };
        return;
      }
    }
    warnings.push(`warn: ${filePath}: unknown key '${path}' (ignored)`);
  });
}

function walkLayer(
  node: Record<string, unknown>,
  prefix: string,
  visit: (path: string, value: unknown) => void,
): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (KNOWN_LEAF_PATHS.has(path)) {
      visit(path, value);
      continue;
    }
    if (isPlainObject(value)) {
      walkLayer(value, path, visit);
    } else {
      visit(path, value);
    }
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function ignorePatterns(config: ResolvedConfig): string[] {
  return config.repo.ignore.value;
}

function phaseSkillKey(phase: ForgePhase): keyof ResolvedConfig["workflow"]["phaseSkills"] {
  return phase === "domain-model" ? "domainModel" : phase;
}

export function phaseSkill(config: ResolvedConfig, phase: ForgePhase): ConfigLeaf<string> {
  return config.workflow.phaseSkills[phaseSkillKey(phase)];
}

export function matchesAnyIgnore(relPath: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  for (const pattern of patterns) {
    if (new Bun.Glob(pattern).match(relPath)) return true;
  }
  return false;
}

export function isIgnoredDir(relDir: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  for (const pattern of patterns) {
    const stripped = pattern.endsWith("/**")
      ? pattern.slice(0, -3)
      : pattern.endsWith("/*")
        ? pattern.slice(0, -2)
        : pattern;
    if (!stripped || stripped.includes("*")) continue;
    if (stripped === relDir) return true;
    if (relDir.startsWith(`${stripped}/`)) return true;
  }
  return false;
}
