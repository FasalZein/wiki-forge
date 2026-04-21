import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { OptimizeTarget, SkillExample, TargetExample, WorkflowExample } from "./types";

const DATASET_FILES: Record<OptimizeTarget, string> = {
  workflow: "workflow-routing.sample.jsonl",
  skill: "skill-optimizer.sample.jsonl",
};

function parseJsonLines<T>(raw: string): T[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${String(error)}`);
      }
    });
}

export async function loadDataset(target: "workflow"): Promise<WorkflowExample[]>;
export async function loadDataset(target: "skill"): Promise<SkillExample[]>;
export async function loadDataset(target: OptimizeTarget): Promise<TargetExample[]> {
  const path = join(import.meta.dir, "..", "datasets", DATASET_FILES[target]);
  const raw = await readFile(path, "utf8");
  return parseJsonLines<TargetExample>(raw);
}
