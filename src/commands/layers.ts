import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { mkdirIfMissing, nowIso, orderFrontmatter, requireValue, writeNormalizedPage } from "../cli-shared";
import { slugify } from "./planning";
import { exists, readText } from "../lib/fs";

const CORE_TOP_LEVEL_DIRS = ["projects", "research", "raw", "wiki", "ideas", "templates", "journal", "specs"] as const;
const CORE_ROOT_FILES = ["AGENTS.md", "index.md", "log.md"] as const;

type LayerDefinition = {
  name: string;
  title: string;
  description: string;
  allowPath: (relPath: string) => boolean;
  scaffold: () => Array<{ path: string; content: string; data: Record<string, unknown> }>;
  createPage: (title: string) => { path: string; content: string; data: Record<string, unknown> };
};

const LAYERS: Record<string, LayerDefinition> = {
  books: {
    name: "books",
    title: "Books",
    description: "Plugin-generated layer for book notes and synthesized takeaways.",
    allowPath: (relPath) => /^books\/(index|[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/u.test(relPath),
    scaffold: () => [{
      path: "books/index.md",
      data: orderFrontmatter({
        title: "Books",
        type: "layer-index",
        layer: "books",
        source_paths: ["src/commands/layers.ts"],
        updated: nowIso(),
        status: "current",
        verification_level: "code-verified",
      }, ["title", "type", "layer", "source_paths", "updated", "status", "verification_level"]),
      content: [
        "# Books",
        "",
        "> [!summary]",
        "> Plugin-generated knowledge layer for book notes and synthesized takeaways.",
        "",
        "## Pages",
        "",
        "- ",
        "",
        "## Cross Links",
        "",
        "- [[index]]",
        "",
      ].join("\n"),
    }],
    createPage: (title) => {
      const slug = slugify(title);
      return {
        path: `books/${slug}.md`,
        data: orderFrontmatter({
          title,
          type: "layer-page",
          layer: "books",
          created_at: nowIso(),
          updated: nowIso(),
          status: "draft",
          verification_level: "scaffold",
        }, ["title", "type", "layer", "created_at", "updated", "status", "verification_level"]),
        content: [
          `# ${title}`,
          "",
          "> [!summary]",
          "> Generated page in the books layer. Capture the book, the takeaways, and why they matter.",
          "",
          "## Summary",
          "",
          "- ",
          "",
          "## Takeaways",
          "",
          "- ",
          "",
          "## Cross Links",
          "",
          "- [[books/index]]",
          "- [[index]]",
          "",
        ].join("\n"),
      };
    },
  },
};

export async function scaffoldLayer(args: string[]) {
  const name = args[0];
  requireValue(name, "layer");
  const layer = LAYERS[name];
  if (!layer) throw new Error(`unknown layer: ${name}`);
  for (const file of layer.scaffold()) {
    const outputPath = join(VAULT_ROOT, file.path);
    mkdirIfMissing(join(VAULT_ROOT, name));
    if (await exists(outputPath)) continue;
    writeNormalizedPage(outputPath, file.content, file.data);
    console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
  }
}

export async function createLayerPage(args: string[]) {
  const layerName = args[0];
  const title = args.slice(1).join(" ").trim();
  requireValue(layerName, "layer");
  requireValue(title || undefined, "title");
  const layer = LAYERS[layerName];
  if (!layer) throw new Error(`unknown layer: ${layerName}`);
  const page = layer.createPage(title);
  const outputPath = join(VAULT_ROOT, page.path);
  mkdirIfMissing(join(VAULT_ROOT, layerName));
  if (await exists(outputPath)) throw new Error(`layer page already exists: ${relative(VAULT_ROOT, outputPath)}`);
  writeNormalizedPage(outputPath, page.content, page.data);
  console.log(`created ${relative(VAULT_ROOT, outputPath)}`);
}

export async function lintVault(args: string[]) {
  const json = args.includes("--json");
  const result = await collectVaultLintResult();
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.issues.length) {
    console.log(`vault lint found ${result.issues.length} issue(s):`);
    for (const issue of result.issues) console.log(`- ${issue}`);
  } else console.log("vault lint passed");
  if (result.issues.length) throw new Error("vault lint failed");
}

export async function collectVaultLintResult() {
  const issues: string[] = [];
  const topLevelEntries = readdirSync(VAULT_ROOT).filter((entry) => !entry.startsWith("."));
  const customLayers = Object.keys(LAYERS);
  const allowedDirs = new Set<string>([...CORE_TOP_LEVEL_DIRS, ...customLayers]);
  const allowedFiles = new Set<string>(CORE_ROOT_FILES);

  for (const entry of topLevelEntries) {
    const fullPath = join(VAULT_ROOT, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (!allowedDirs.has(entry)) {
        issues.push(`${entry}/ unknown top-level layer: register it through a generator/plugin before adding files`);
        continue;
      }
      const layer = LAYERS[entry];
      if (!layer) continue;
      const files = [...new Bun.Glob("**/*.md").scanSync({ cwd: fullPath, onlyFiles: true })];
      if (!files.length) issues.push(`${entry}/ empty custom layer: run scaffold-layer or create-layer-page`);
      for (const file of files) {
        const rel = `${entry}/${file.replaceAll("\\", "/")}`;
        if (!layer.allowPath(rel)) issues.push(`${rel} invalid custom-layer path for ${entry}`);
      }
      continue;
    }
    if (stats.isFile() && entry.endsWith(".md") && !allowedFiles.has(entry)) issues.push(`${entry} unexpected root markdown file`);
  }

  for (const layer of customLayers) {
    const layerIndex = join(VAULT_ROOT, layer, "index.md");
    if (await exists(join(VAULT_ROOT, layer)) && !await exists(layerIndex)) issues.push(`${layer}/ missing index.md`);
  }

  return { root: VAULT_ROOT, issues, layers: { core: [...CORE_TOP_LEVEL_DIRS], custom: customLayers } };
}

export async function summarizeLayer(args: string[]) {
  const name = args[0];
  requireValue(name, "layer");
  const layer = LAYERS[name];
  if (!layer) throw new Error(`unknown layer: ${name}`);
  const layerDir = join(VAULT_ROOT, name);
  const pages = await exists(layerDir) ? [...new Bun.Glob("**/*.md").scanSync({ cwd: layerDir, onlyFiles: true })] : [];
  const previews: string[] = [];
  for (const file of pages.slice(0, 5)) {
    const body = await readText(join(layerDir, file));
    const heading = body.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/u, "") ?? file;
    previews.push(`- ${heading}`);
  }
  console.log(`# ${layer.title}\n\n${layer.description}\n\nPages: ${pages.length}\n${previews.join("\n")}`);
}
