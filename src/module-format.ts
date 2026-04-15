import GithubSlugger from "github-slugger";
import { dirname, join } from "node:path";
import { MODULE_REQUIRED_HEADINGS } from "./constants";
import { extractWikilinks as extractWikilinksAst } from "./lib/markdown-ast";
import { isNonMarkdownAttachment, normalizePath, stripMarkdownExtension } from "./lib/notes";
import type { FrontmatterData, NoteIndex, NoteInfo } from "./types";
import { findTableSpacingProblems } from "./cli-shared";

const headingSlugger = new GithubSlugger();

export function lintFrontmatter(vaultPath: string, content: string, safeMatter: (pathLabel: string, content: string, options?: { silent?: boolean }) => { content: string; data: FrontmatterData } | null): { body: string; missingFields: string[]; error?: string } {
  const parsed = safeMatter(vaultPath, content);
  if (!parsed) {
    return { body: content, missingFields: [], error: "unable to parse yaml frontmatter" };
  }

  const required = requiredFrontmatterFields(vaultPath);
  const missingFields = required.filter((field) => !(field in parsed.data));
  return { body: parsed.content, missingFields };
}

export function normalizeModuleFrontmatter(project: string, moduleName: string, data: FrontmatterData, changes: string[]): FrontmatterData {
  const next: FrontmatterData = { ...data };

  if (next.title !== moduleTitle(moduleName)) {
    next.title = moduleTitle(moduleName);
    changes.push("updated title frontmatter");
  }
  if (next.type !== "module") {
    next.type = "module";
    changes.push("set type: module");
  }
  if (next.project !== project) {
    next.project = project;
    changes.push(`set project: ${project}`);
  }
  if (next.module !== moduleName) {
    next.module = moduleName;
    changes.push(`set module: ${moduleName}`);
  }
  if (next.status !== "current") {
    next.status = "current";
    changes.push("set status: current");
  }
  if (!next.updated) {
    next.updated = today();
    changes.push("set updated date");
  }
  if (!next.verification_level) {
    next.verification_level = "code-verified";
    changes.push("set verification_level: code-verified");
  }

  return orderFrontmatter(next, ["title", "type", "project", "module", "updated", "status", "verification_level", "source_paths", "aliases"]);
}

export function lintWikilinks(currentVaultPath: string, body: string, noteIndex: NoteIndex): string[] {
  const issues: string[] = [];
  const links = extractWikilinks(body);

  for (const link of links) {
    const resolution = resolveWikilinkTarget(currentVaultPath, link.pathTarget, noteIndex);
    if (resolution.kind === "missing") {
      issues.push(`missing wikilink: [[${link.rawTarget}]]`);
      continue;
    }
    if (resolution.kind === "ambiguous") {
      issues.push(`ambiguous wikilink: [[${link.rawTarget}]] -> ${resolution.candidates.join(", ")}`);
      continue;
    }

    if (link.headingTarget && !link.headingTarget.startsWith("^") && !resolution.note.headings.has(normalizeHeading(link.headingTarget))) {
      issues.push(`broken heading link: [[${link.rawTarget}]]`);
    }
  }

  return issues;
}

export function ensurePrimaryHeading(body: string, title: string, changes: string[]) {
  if (body.startsWith(`# ${title}\n`) || body === `# ${title}`) {
    return body;
  }
  changes.push("inserted canonical h1 heading");
  return `# ${title}\n\n${body.trim()}`;
}

export function normalizeInterfacesSection(body: string, changes: string[]) {
  if (!body.includes("## Interfaces")) {
    return body;
  }
  if (body.includes("## Interfaces\n\n### API / UI Surface")) {
    return body;
  }
  changes.push("normalized interfaces heading");
  return body.replace("## Interfaces\n\n|", "## Interfaces\n\n### API / UI Surface\n\n|");
}

export function normalizeTableSpacing(body: string, changes: string[]) {
  const problems = findTableSpacingProblems(body);
  if (!problems.length) {
    return body;
  }

  changes.push(...problems);
  const lines = body.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = out[out.length - 1] ?? "";
    if (line.trimStart().startsWith("|") && previous.trim() && !previous.trimStart().startsWith("|")) {
      out.push("");
    }
    out.push(line);
  }

  return out.join("\n");
}

export function ensureSection(body: string, heading: string, content: string, changes: string[]) {
  if (body.includes(`${heading}\n`) || body.endsWith(heading)) {
    return body;
  }
  changes.push(`added section: ${heading.replace(/^##\s+/u, "")}`);
  return `${body.trim()}\n\n${heading}\n\n${content.trim()}\n`;
}

export function defaultHighlightsSection() {
  return `> [!note]\n> TODO: Summarize the highest-signal fact about this module.\n\n> [!warning]\n> TODO: Record the biggest known risk, inconsistency, or gap.`;
}

export function defaultOwnershipSection() {
  return `| Surface | Details |\n|---------|---------|\n| Primary responsibility | TODO |\n| Code paths | See \`## Key Files\` |\n| Routes / UI surfaces | See \`## Interfaces\` |\n| Tables | See \`## Data Model\` |\n| Jobs / async flows | TODO |`;
}

export function defaultKeyFilesSection() {
  return `| Path | Layer | Purpose |\n|------|-------|---------|\n| \`TODO\` | TODO | TODO |`;
}

export function defaultInterfacesSection() {
  return `### API / UI Surface\n\n| Method / Surface | Path / Screen | Auth | Purpose |\n|------------------|---------------|------|---------|\n| TODO | \`TODO\` | TODO | TODO |`;
}

export function defaultDataModelSection() {
  return `### Tables\n\n**\`TODO\`** -- TODO\n\n| Column | Type | Notes |\n|--------|------|-------|\n| TODO | TODO | TODO |\n\n### Relationships\n\n\`\`\`text\nTODO\n\`\`\``;
}

export function defaultDependenciesSection() {
  return `### Depends On\n\n| Module / Entity | Why |\n|-----------------|-----|\n| TODO module or entity | TODO |\n\n### Used By\n\n| Module / Page | Why |\n|---------------|-----|\n| TODO module or page | TODO |`;
}

export function defaultVerificationSection() {
  return `| Check | Status | Notes |\n|-------|--------|-------|\n| Code read | yes | Compiled from code reading |\n| Runtime verified | no | TODO |\n| Tests verified | no | TODO |`;
}

export function defaultCrossLinksSection(project: string, moduleName: string) {
  return `- [[projects/${project}/_summary]]\n- [[projects/${project}/architecture/module-dependency-map]]\n- [[projects/${project}/contracts/api]]\n- [[projects/${project}/data/module-to-table-map]]\n- [[projects/${project}/verification/coverage]]\n- [[projects/${project}/modules/${moduleName}/spec]]`;
}

function requiredFrontmatterFields(vaultPath: string): string[] {
  const rel = vaultPath.replace(/\\/g, "/");
  if (rel.startsWith("projects/") && rel.endsWith("/_summary")) return ["title", "type", "project", "updated", "status"];
  if (rel.includes("/modules/") && rel.endsWith("/spec")) return ["module", "updated", "status"];
  if (/(^projects\/[^/]+\/(architecture|code-map|contracts|data|changes|runbooks|verification|legacy)\/.*)$/u.test(rel)) {
    return ["title", "type", "project", "updated", "status"];
  }
  return [];
}

function resolveWikilinkTarget(currentVaultPath: string, rawTarget: string, noteIndex: NoteIndex):
  | { kind: "resolved"; note: NoteInfo }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: string[] } {
  const target = stripMarkdownExtension(normalizePath(rawTarget));
  const explicitPathTarget = target.includes("/") || rawTarget.startsWith(".");
  const exact = noteIndex.byVaultPath.get(target);
  if (exact && explicitPathTarget) return { kind: "resolved", note: exact };

  const relativeTarget = stripMarkdownExtension(normalizePath(join(dirname(currentVaultPath), rawTarget)));
  const relativeMatch = noteIndex.byVaultPath.get(relativeTarget);
  if (relativeMatch && explicitPathTarget) return { kind: "resolved", note: relativeMatch };

  const candidates = new Map<string, NoteInfo>();
  if (exact) candidates.set(exact.vaultPath, exact);
  if (relativeMatch) candidates.set(relativeMatch.vaultPath, relativeMatch);
  for (const match of noteIndex.byBasename.get(target.split("/").pop()!.toLowerCase()) ?? []) candidates.set(match.vaultPath, match);
  for (const match of noteIndex.byAlias.get(target.toLowerCase()) ?? []) candidates.set(match.vaultPath, match);

  if (candidates.size === 0) return { kind: "missing" };
  if (candidates.size === 1) return { kind: "resolved", note: [...candidates.values()][0] };
  return { kind: "ambiguous", candidates: [...candidates.keys()].sort() };
}

function extractWikilinks(body: string) {
  const links: { rawTarget: string; pathTarget: string; headingTarget?: string }[] = [];
  for (const wl of extractWikilinksAst(body)) {
    const raw = wl.alias ? `${wl.target}${wl.anchor ? `#${wl.anchor}` : ""}|${wl.alias}` : `${wl.target}${wl.anchor ? `#${wl.anchor}` : ""}`;
    if (isNonMarkdownAttachment(wl.target)) continue;
    links.push({ rawTarget: raw, pathTarget: wl.target, headingTarget: wl.anchor ?? undefined });
  }
  return links;
}

function normalizeHeading(value: string) {
  headingSlugger.reset();
  return headingSlugger.slug(value.trim());
}

function moduleTitle(moduleName: string) {
  return `${moduleName.split(/[-_]/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")} Module`;
}

function orderFrontmatter(data: FrontmatterData, preferredOrder: string[]) {
  const ordered: FrontmatterData = {};
  for (const key of preferredOrder) if (key in data) ordered[key] = data[key];
  for (const [key, value] of Object.entries(data)) if (!(key in ordered)) ordered[key] = value;
  return ordered;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
