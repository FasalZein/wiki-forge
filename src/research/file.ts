import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, writeNormalizedPage } from "../cli-shared";
import { exists } from "../lib/fs";
import {
  canonicalizeResearchTopicForWrite,
  researchPagePath,
  slugifyResearchPage,
  topicCrossLinks,
} from "../lib/research";
import { ensureResearchTopic, projectTruthTargets } from "./_shared";

export async function createResearchPage(topic: string, title: string, project?: string) {
  const normalizedTopic = canonicalizeResearchTopicForWrite(topic, project);
  await ensureResearchTopic(normalizedTopic);
  const slug = slugifyResearchPage(title);
  const outputPath = researchPagePath(normalizedTopic, slug);
  if (await exists(outputPath)) throw new Error(`research page already exists: ${relative(VAULT_ROOT, outputPath)}`);
  const data = orderFrontmatter({
    title,
    type: "research",
    topic: normalizedTopic,
    ...(project ? { project } : {}),
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
    project
      ? `> Research synthesis note. Capture conclusions here, then hand off accepted findings into [[${projectTruthTargets(project)[0]}]] or [[${projectTruthTargets(project)[1]}]]. If this research unblocks a tracked slice, follow with \`wiki research bridge <research-page> --project ${project} --slice <slice-id>\`.`
      : "> Research synthesis note. Capture conclusions here, then link the evidence that supports them.",
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
    ...(project ? ["- [[projects/" + project + "/decisions]]", "- [[projects/" + project + "/architecture/domain-language]]"] : []),
    "",
  ].join("\n");
  writeNormalizedPage(outputPath, body, data);
  return { topic: normalizedTopic, outputPath };
}
