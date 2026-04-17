import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, writeNormalizedPage } from "../cli-shared";
import { exists } from "../lib/fs";
import { normalizeTopicPath, researchPagePath, slugifyResearchPage, topicCrossLinks } from "../lib/research";
import { ensureResearchTopic } from "./_shared";

export async function createResearchPage(project: string, title: string, topic?: string) {
  const normalizedTopic = normalizeTopicPath(topic ?? `projects/${project}`);
  await ensureResearchTopic(normalizedTopic);
  const slug = slugifyResearchPage(title);
  const outputPath = researchPagePath(normalizedTopic, slug);
  if (await exists(outputPath)) throw new Error(`research page already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
    title,
    type: "research",
    topic: normalizedTopic,
    project,
    status: "draft",
    source_type: "synthesis",
    sources: [],
    influenced_by: [],
    created_at: nowIso(),
    updated: nowIso(),
    verification_level: "unverified",
  }, ["title", "type", "topic", "project", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
  const body = [
    `# ${title}`,
    "",
    "> [!summary]",
    "> Research synthesis note. Capture conclusions here, then link the evidence that supports them.",
    "",
    "## TL;DR",
    "",
    "",
    "",
    "## Key Findings",
    "",
    "- ",
    "",
    "## Landscape / Comparison",
    "",
    "",
    "",
    "## Open Questions",
    "",
    "- ",
    "",
    "## Sources",
    "",
    "[1] ",
    "",
    "## Cross Links",
    "",
    ...topicCrossLinks(normalizedTopic),
    "",
  ].join("\n");
  writeNormalizedPage(outputPath, body, data);
  return { topic: normalizedTopic, outputPath };
}
