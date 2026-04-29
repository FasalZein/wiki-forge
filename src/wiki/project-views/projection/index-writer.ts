import { relative } from "node:path";
import { VAULT_ROOT } from "../../../constants";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../../../cli-shared";
import { exists, readText, writeText } from "../../../lib/fs";

export async function writeIndexTarget(absolutePath: string, content: string) {
  const relPath = relative(VAULT_ROOT, absolutePath).replaceAll("\\", "/");
  const generated = generatedIndexFrontmatter(relPath);
  if (!await exists(absolutePath)) {
    if (!generated) return writeText(absolutePath, content);
    return writeNormalizedPage(absolutePath, content, generated);
  }

  const raw = await readText(absolutePath);
  const parsed = safeMatter(relative(VAULT_ROOT, absolutePath), raw, { silent: true });
  if (!parsed) {
    if (!generated) return writeText(absolutePath, content);
    return writeNormalizedPage(absolutePath, content, generated);
  }

  const generatedSources = generated && Array.isArray(generated.source_paths) ? generated.source_paths : [];
  const parsedSources = Array.isArray(parsed.data.source_paths) ? parsed.data.source_paths : [];
  const data = orderFrontmatter({
    ...(generated ?? {}),
    ...parsed.data,
    source_paths: [...new Set([...generatedSources, ...parsedSources])],
    updated: nowIso(),
  }, ["title", "type", "project", "source_paths", "created_at", "updated", "status", "verification_level"]);
  writeNormalizedPage(absolutePath, content, data);
}

function generatedIndexFrontmatter(relPath: string) {
  const match = relPath.match(/^projects\/([^/]+)\/specs(?:\/(features|prds|slices|archive))?\/index\.md$/u);
  if (!match) return null;
  const [, project, family] = match;
  const title = indexTitle(project, family);
  return orderFrontmatter({
    title,
    type: "index",
    project,
    source_paths: [
      "src/wiki/project-views/projection/index-log.ts",
      "src/wiki/project-views/projection/relationships.ts",
      "src/wiki/project-views/projection/markdown.ts",
      "src/lib/structure.ts",
      "src/wiki/project-views/backlog.ts",
    ],
    updated: nowIso(),
    status: "current",
    verification_level: "code-verified",
  }, ["title", "type", "project", "source_paths", "updated", "status", "verification_level"]);
}

function indexTitle(project: string, family: string | undefined) {
  if (family === "features") return `${project} Features`;
  if (family === "prds") return `${project} PRDs`;
  if (family === "slices") return `${project} Slices`;
  if (family === "archive") return `${project} Archive`;
  return `${project} Index`;
}
