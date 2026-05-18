import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireValue } from "../../cli-shared";
import { VAULT_ROOT } from "../../constants";
import { printJson, printLine } from "../../lib/cli-output";
import { slugify } from "../../lib/slug";

export type ForgeGrillRecordResult = {
  readonly status: "recorded";
  readonly project: string;
  readonly contextPath?: string;
  readonly decisionRefs: readonly string[];
};

export async function forgeGrillCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--context-file", "--context", "--context-name", "--decision-title", "--decision", "--decision-file", "--tag"]);
  const action = positional[0];
  if (action !== "record") throw new Error(`unknown forge grill subcommand: ${action ?? ""}. Use 'record'.`);
  const project = positional[1];
  requireValue(project, "project");

  const result = recordGrillArtifacts({
    project,
    contextFile: readFlagValue(args, "--context-file"),
    contextName: readFlagValue(args, "--context-name") ?? readFlagValue(args, "--context"),
    decisionTitle: readFlagValue(args, "--decision-title"),
    decisionText: readFlagOrFile(args, "--decision", "--decision-file"),
    tags: readRepeatedFlagValues(args, "--tag"),
  });

  if (json) printJson(result);
  else {
    if (result.contextPath) printLine(`updated ${result.contextPath}`);
    for (const ref of result.decisionRefs) printLine(`recorded ${ref}`);
    if (!result.contextPath && result.decisionRefs.length === 0) printLine(`no grill artifacts recorded for ${project}`);
  }
}

export function recordGrillArtifacts(input: {
  readonly project: string;
  readonly contextFile?: string;
  readonly contextName?: string;
  readonly decisionTitle?: string;
  readonly decisionText?: string;
  readonly tags?: readonly string[];
}): ForgeGrillRecordResult {
  const projectDir = join(VAULT_ROOT, "projects", input.project);
  const architectureDir = join(projectDir, "architecture");
  const contextsDir = join(architectureDir, "contexts");
  const adrsDir = join(projectDir, "adrs");
  mkdirSync(architectureDir, { recursive: true });

  let contextPath: string | undefined;
  if (input.contextFile) {
    const content = readFileSync(input.contextFile, "utf8").trimEnd();
    const contextName = input.contextName?.trim();
    if (contextName) {
      const contextSlug = slugify(contextName, "context");
      mkdirSync(contextsDir, { recursive: true });
      const absoluteContextPath = join(contextsDir, `${contextSlug}.md`);
      writeFileSync(absoluteContextPath, `${content}\n`, "utf8");
      contextPath = `projects/${input.project}/architecture/contexts/${contextSlug}.md`;
      upsertContextMapEntry(join(architectureDir, "context-map.md"), input.project, contextSlug, contextName);
    } else {
      const absoluteContextPath = join(architectureDir, "domain-language.md");
      writeFileSync(absoluteContextPath, `${content}\n`, "utf8");
      contextPath = `projects/${input.project}/architecture/domain-language.md`;
    }
  }

  const decisionRefs: string[] = [];
  const decisionTitle = input.decisionTitle?.trim();
  const decisionText = input.decisionText?.trim();
  if (decisionTitle || decisionText) {
    requireValue(decisionTitle, "--decision-title");
    requireValue(decisionText, "--decision or --decision-file");
    const decisionsPath = join(projectDir, "decisions.md");
    const existing = existsSync(decisionsPath) ? readFileSync(decisionsPath, "utf8") : "# Decisions\n";
    const nextNumber = nextAdrNumber(existing);
    const adrId = `ADR-${String(nextNumber).padStart(4, "0")}`;
    const tags = normalizeTags(input.tags);
    const tagSuffix = formatTags(tags);
    const adrSlug = `${adrId}-${slugify(decisionTitle, "decision")}`;
    const adrPath = join(adrsDir, `${adrSlug}.md`);
    const adrRef = `projects/${input.project}/adrs/${adrSlug}.md`;
    const adrEntry = [
      `# ${adrId} — ${decisionTitle}`,
      "",
      "- Status: accepted",
      ...(tags.length ? [`- Related: ${tags.join(", ")}`] : []),
      `- Decision: ${decisionText}`,
      "",
    ].join("\n");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(adrPath, adrEntry, "utf8");

    const indexEntry = `- [[projects/${input.project}/adrs/${adrSlug}|${adrId} — ${decisionTitle}]]${tagSuffix}`;
    const prefix = existing.trimEnd();
    writeFileSync(decisionsPath, `${prefix}\n\n${indexEntry}\n`, "utf8");
    decisionRefs.push(adrRef);
  }

  return { status: "recorded", project: input.project, ...(contextPath ? { contextPath } : {}), decisionRefs };
}

function nextAdrNumber(content: string): number {
  const matches = [...content.matchAll(/ADR-(\d{4})/gu)].map((match) => Number(match[1]));
  return matches.length === 0 ? 1 : Math.max(...matches) + 1;
}

function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  if (!tags) return [];
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function formatTags(tags: readonly string[]): string {
  return tags.length === 0 ? "" : ` ${tags.map((tag) => `[${tag}]`).join(" ")}`;
}

function upsertContextMapEntry(contextMapPath: string, project: string, contextSlug: string, contextName: string): void {
  const existing = existsSync(contextMapPath) ? readFileSync(contextMapPath, "utf8") : "# Context Map\n\n## Contexts\n";
  const entry = `- [[projects/${project}/architecture/contexts/${contextSlug}|${contextName}]]`;
  if (existing.includes(entry)) return;
  writeFileSync(contextMapPath, `${existing.trimEnd()}\n${entry}\n`, "utf8");
}

function readPositionalArgs(args: readonly string[], valueFlags: readonly string[]): readonly string[] {
  const valueFlagSet = new Set(valueFlags);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueFlagSet.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readFlagOrFile(args: readonly string[], valueFlag: string, fileFlag: string): string | undefined {
  const inline = readFlagValue(args, valueFlag);
  const filePath = readFlagValue(args, fileFlag);
  if (inline !== undefined && filePath !== undefined) throw new Error(`use either ${valueFlag} or ${fileFlag}, not both`);
  if (filePath !== undefined) return readFileSync(filePath, "utf8");
  return inline;
}

function readRepeatedFlagValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing ${flag}`);
    values.push(value);
    index += 1;
  }
  return values;
}
