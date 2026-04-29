import type { ProjectPageRow } from "./relationships";

type SectionUpdate = { heading: string; lines: string[]; insertBefore?: string };

export function rewriteRowSections(row: ProjectPageRow, sections: SectionUpdate[]) {
  let content = row.content;
  for (const section of sections) content = upsertSection(content, section.heading, section.lines, section.insertBefore);
  return `${content.trim()}\n`;
}

export function renderLinks(rows: ProjectPageRow[]) {
  return rows.length ? rows.map((row) => linkLine(row)) : ["- none"];
}

export function linkLine(row: ProjectPageRow) {
  return `- [[${row.linkPath}|${row.title}]]`;
}

export function relatedPlanningLines(featureRows: ProjectPageRow[], prdRows: ProjectPageRow[], sliceRows: ProjectPageRow[]) {
  return [
    "### Features",
    "",
    ...renderLinks(featureRows),
    "",
    "### PRDs",
    "",
    ...renderLinks(prdRows),
    "",
    "### Slices",
    "",
    ...renderLinks(sliceRows),
  ];
}

function upsertSection(content: string, heading: string, lines: string[], insertBefore?: string) {
  const section = `## ${heading}`;
  const body = lines.length ? lines.join("\n") : "- none";
  const pattern = new RegExp(`## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |$)`, "u");
  if (pattern.test(content)) return content.replace(pattern, `${section}\n\n${body}\n`);
  const anchor = insertBefore ? `## ${insertBefore}` : "## Cross Links";
  if (content.includes(anchor)) return content.replace(anchor, `${section}\n\n${body}\n\n${anchor}`);
  return `${content.trim()}\n\n${section}\n\n${body}\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
