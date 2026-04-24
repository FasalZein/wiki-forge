import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { OptimizeTarget, SkillExample, TargetExample, WorkflowExample } from "./types";

const DATASET_FILES: Record<OptimizeTarget, string> = {
  workflow: "workflow-routing.sample.jsonl",
  skill: "skill-optimizer.sample.jsonl",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function assertWorkflowExample(value: unknown, line: number): asserts value is WorkflowExample {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.input) || !isRecord(value.expected)) {
    throw new Error(`invalid workflow example at line ${line}: expected id, input, and expected objects`);
  }
  const input = value.input;
  const expected = value.expected;
  if (
    typeof input.project !== "string"
    || typeof input.stateSnapshot !== "string"
    || typeof input.currentOutput !== "string"
    || typeof input.repairContext !== "string"
    || typeof input.goal !== "string"
  ) {
    throw new Error(`invalid workflow example at line ${line}: input fields must be strings`);
  }
  if (input.allowedCommands !== undefined && !isStringArray(input.allowedCommands)) throw new Error(`invalid workflow example at line ${line}: allowedCommands must be string[]`);
  if (input.forbiddenCommands !== undefined && !isStringArray(input.forbiddenCommands)) throw new Error(`invalid workflow example at line ${line}: forbiddenCommands must be string[]`);
  if (
    typeof expected.blockerType !== "string"
    || typeof expected.lane !== "string"
    || typeof expected.nextCommand !== "string"
  ) {
    throw new Error(`invalid workflow example at line ${line}: expected fields must include blockerType, lane, and nextCommand`);
  }
  if (expected.forbiddenCommands !== undefined && !isStringArray(expected.forbiddenCommands)) throw new Error(`invalid workflow example at line ${line}: expected.forbiddenCommands must be string[]`);
  if (expected.maxReasonLength !== undefined && typeof expected.maxReasonLength !== "number") throw new Error(`invalid workflow example at line ${line}: maxReasonLength must be a number`);
}

function assertSkillExample(value: unknown, line: number): asserts value is SkillExample {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.input) || !isRecord(value.expected)) {
    throw new Error(`invalid skill example at line ${line}: expected id, input, and expected objects`);
  }
  const input = value.input;
  const expected = value.expected;
  if (
    typeof input.skillName !== "string"
    || typeof input.taskBrief !== "string"
    || typeof input.currentSkill !== "string"
    || typeof input.acceptanceCriteria !== "string"
    || typeof input.repoContext !== "string"
  ) {
    throw new Error(`invalid skill example at line ${line}: input fields must be strings`);
  }
  if (input.requiredPhrases !== undefined && !isStringArray(input.requiredPhrases)) throw new Error(`invalid skill example at line ${line}: requiredPhrases must be string[]`);
  if (input.forbiddenPhrases !== undefined && !isStringArray(input.forbiddenPhrases)) throw new Error(`invalid skill example at line ${line}: forbiddenPhrases must be string[]`);
  if (!isStringArray(expected.mustInclude)) throw new Error(`invalid skill example at line ${line}: mustInclude must be string[]`);
  if (expected.mustAvoid !== undefined && !isStringArray(expected.mustAvoid)) throw new Error(`invalid skill example at line ${line}: mustAvoid must be string[]`);
  if (expected.maxRationaleLength !== undefined && typeof expected.maxRationaleLength !== "number") throw new Error(`invalid skill example at line ${line}: maxRationaleLength must be a number`);
}

function parseJsonLines(raw: string): unknown[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
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
  const records = parseJsonLines(raw);
  if (target === "workflow") {
    const workflowRecords: WorkflowExample[] = [];
    records.forEach((record, index) => {
      assertWorkflowExample(record, index + 1);
      workflowRecords.push(record);
    });
    return workflowRecords;
  }
  const skillRecords: SkillExample[] = [];
  records.forEach((record, index) => {
    assertSkillExample(record, index + 1);
    skillRecords.push(record);
  });
  return skillRecords;
}
