import { createHash } from "node:crypto";

import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { assertExists, projectRoot, requireValue, safeMatter } from "../../cli-shared";
import { readText, writeText } from "../../lib/fs";
import { toVaultMarkdownPath } from "../../lib/structure";
import { walkMarkdown } from "../../lib/vault";

type GraphNode = {
  id: string;
  key: string;
  kind: "feature" | "prd" | "slice";
  title: string;
  file: string;
  featureId?: string;
  prdId?: string;
  taskId?: string;
  parentFeature?: string;
  parentPrd?: string;
  dependsOn: string[];
};

type GraphEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
  color?: string;
};

export async function dependencyGraph(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const write = args.includes("--write");
  const result = await collectDependencyGraph(project);
  if (write) await writeText(result.outputPath, JSON.stringify(result.canvas, null, 2));
  if (json) console.log(JSON.stringify({ ...result, canvas: undefined, written: write }, null, 2));
  else {
    console.log(`dependency-graph for ${project}:`);
    console.log(`- nodes: ${result.counts.nodes}`);
    console.log(`- edges: ${result.counts.edges}`);
    console.log(`- missing refs: ${result.counts.missingRefs}`);
    console.log(`- cycles: ${result.counts.cycles}`);
    console.log(`- output: ${relative(VAULT_ROOT, result.outputPath)}`);
    if (write) console.log(`- wrote canvas`);
    for (const ref of result.missingRefs.slice(0, 10)) console.log(`  - missing: ${ref.from} -> ${ref.to}`);
    for (const cycle of result.cycles.slice(0, 10)) console.log(`  - cycle: ${cycle.join(" -> ")}`);
  }
  if (result.missingRefs.length || result.cycles.length) throw new Error(`dependency-graph check failed for ${project}`);
}

export async function collectDependencyGraph(project: string) {
  const root = projectRoot(project);
  await assertExists(root, `project not found: ${project}`);
  const entries = await loadGraphNodes(project);
  const byFeature = new Map(entries.filter((entry) => entry.featureId).map((entry) => [entry.featureId!, entry]));
  const byPrd = new Map(entries.filter((entry) => entry.prdId).map((entry) => [entry.prdId!, entry]));
  const byTask = new Map(entries.filter((entry) => entry.taskId).map((entry) => [entry.taskId!, entry]));
  const edges: GraphEdge[] = [];
  const missingRefs: Array<{ from: string; to: string }> = [];

  for (const entry of entries) {
    if (entry.parentFeature) {
      const target = byFeature.get(entry.parentFeature);
      if (target) edges.push(makeEdge(target.id, entry.id, "feature"));
      else missingRefs.push({ from: entry.key, to: entry.parentFeature });
    }
    if (entry.parentPrd) {
      const target = byPrd.get(entry.parentPrd);
      if (target) edges.push(makeEdge(target.id, entry.id, "prd"));
      else missingRefs.push({ from: entry.key, to: entry.parentPrd });
    }
    for (const dependency of entry.dependsOn) {
      const target = byTask.get(dependency);
      if (target) edges.push(makeEdge(target.id, entry.id, "depends_on", "6"));
      else missingRefs.push({ from: entry.key, to: dependency });
    }
  }

  const canvas = buildCanvas(project, entries, dedupeEdges(edges));
  const cycles = detectCycles(entries.filter((entry) => entry.taskId).map((entry) => ({ id: entry.taskId!, deps: entry.dependsOn }))).map((cycle) => cycle.map((taskId) => byTask.get(taskId)?.key ?? taskId));
  const outputPath = join(root, "verification", "dependency-graph.canvas");
  return {
    project,
    outputPath,
    counts: { nodes: entries.length, edges: canvas.edges.length, missingRefs: missingRefs.length, cycles: cycles.length },
    missingRefs,
    cycles,
    canvas,
  };
}

async function loadGraphNodes(project: string): Promise<GraphNode[]> {
  const root = projectRoot(project);
  const nodes: GraphNode[] = [];
  for (const file of await walkMarkdown(join(root, "specs"))) {
    const parsed = safeMatter(relative(VAULT_ROOT, file), await readText(file), { silent: true });
    if (!parsed) continue;
    const data = parsed.data;
    const kind = String(data.spec_kind ?? "");
    if (kind !== "feature" && kind !== "prd" && kind !== "task-hub") continue;
    const featureId = typeof data.feature_id === "string" ? data.feature_id : undefined;
    const prdId = typeof data.prd_id === "string" ? data.prd_id : undefined;
    const taskId = typeof data.task_id === "string" ? data.task_id : undefined;
    const key = featureId ?? prdId ?? taskId;
    if (!key) continue;
    nodes.push({
      id: stableId(`node:${key}`),
      key,
      kind: kind === "task-hub" ? "slice" : (kind as "feature" | "prd"),
      title: typeof data.title === "string" ? data.title : key,
      file: toVaultMarkdownPath(file),
      featureId,
      prdId,
      taskId,
      parentFeature: typeof data.parent_feature === "string" ? data.parent_feature : undefined,
      parentPrd: typeof data.parent_prd === "string" ? data.parent_prd : undefined,
      dependsOn: normalizeDependsOn(data.depends_on),
    });
  }
  return nodes.sort((a, b) => sortKind(a.kind).localeCompare(sortKind(b.kind)) || a.key.localeCompare(b.key));
}

function buildCanvas(project: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const positioned = nodes.map((node, index) => {
    let column: number;
    if (node.kind === "feature") column = 0;
    else if (node.kind === "prd") column = 1;
    else column = 2;
    let color: string;
    if (node.kind === "feature") color = "4";
    else if (node.kind === "prd") color = "2";
    else color = "5";
    const row = nodes.filter((entry) => entry.kind === node.kind).findIndex((entry) => entry.key === node.key);
    return {
      id: node.id,
      type: "file",
      x: column * 460,
      y: row * 220,
      width: 380,
      height: 160,
      file: node.file,
      color,
    };
  });
  return { nodes: positioned, edges };
}

function normalizeDependsOn(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean))].sort();
}

function makeEdge(fromNode: string, toNode: string, label: string, color?: string): GraphEdge {
  return {
    id: stableId(`edge:${fromNode}:${toNode}:${label}`),
    fromNode,
    toNode,
    label,
    ...(color ? { color } : {}),
  };
}

function dedupeEdges(edges: GraphEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.fromNode}:${edge.toNode}:${edge.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectCycles(nodes: Array<{ id: string; deps: string[] }>) {
  const deps = new Map(nodes.map((node) => [node.id, node.deps]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(id: string, stack: string[]) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const nextStack = [...stack, id];
    for (const dep of deps.get(id) ?? []) if (deps.has(dep)) visit(dep, nextStack);
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) visit(node.id, []);
  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: string[][]) {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = cycle.join("->");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sortKind(kind: GraphNode["kind"]) {
  if (kind === "feature") return "0";
  if (kind === "prd") return "1";
  return "2";
}
