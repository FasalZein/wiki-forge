import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { safeMatter } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { exists, readText } from "./fs";
import { extractWikilinks } from "./markdown-ast";

export type MatterDoc = {
  path: string;
  data: Record<string, unknown>;
  content: string;
};

export async function readMatterDoc(path: string, vaultRoot = VAULT_ROOT): Promise<MatterDoc | null> {
  if (!await exists(path)) return null;
  const raw = await readText(path);
  const parsed = safeMatter(relative(vaultRoot, path), raw, { silent: true });
  if (!parsed) return null;
  return { path, data: parsed.data, content: parsed.content };
}

export async function readPlanningDoc(dir: string, id: string, vaultRoot = VAULT_ROOT): Promise<MatterDoc | null> {
  if (!await exists(dir)) return null;
  const file = readdirSync(dir).find((entry) => entry.startsWith(`${id}-`) && entry.endsWith(".md"));
  return file ? readMatterDoc(join(dir, file), vaultRoot) : null;
}

export function extractMarkdownSection(markdown: string, heading: string) {
  const sections = markdown.split(/^## /mu);
  for (const section of sections) {
    const firstLineEnd = section.indexOf("\n");
    if (firstLineEnd === -1) continue;
    const sectionHeading = section.slice(0, firstLineEnd).trim();
    if (sectionHeading === heading) return section.slice(firstLineEnd).trim();
  }
  return "";
}

export function collectPriorResearchRefs(prdDoc: MatterDoc | null): string[] {
  if (!prdDoc) return [];
  const section = extractMarkdownSection(prdDoc.content, "Prior Research");
  if (!section) return [];
  const refs = extractWikilinks(section).map((link) => link.anchor ? `${link.target}#${link.anchor}` : link.target);
  return [...new Set(refs)];
}
