import { ax } from "@ax-llm/ax";

import type { OptimizeTarget } from "./types";

function createWorkflowProgram() {
  return ax(
    'project:string "Project name"'
      + ', stateSnapshot:string "Serialized state snapshot from resume/status/maintain output"'
      + ', currentOutput:string "Current agent-facing output to improve"'
      + ', repairContext:string "Known failure modes, repair constraints, and authority order"'
      + ', goal:string "What the surface should achieve"'
      + ' -> lane:class "domain-work, implementation-work, maintenance-refresh, verify-close, audited-exception" "Best operator lane"'
      + ', nextCommand:string "Single best next command with exact CLI form"'
      + ', reason:string "Short reason for that next command"'
      + ', compactResponse:string "Compact operator-facing response that does not add loop-inducing noise"',
    {
      description: "Optimize workflow-facing guidance so the agent chooses the correct lane and next command without falling into stale repair loops.",
    },
  );
}

function createSkillProgram() {
  return ax(
    'skillName:string "Name of the skill being improved"'
      + ', taskBrief:string "What the optimized skill should improve"'
      + ', currentSkill:string "Current skill text"'
      + ', acceptanceCriteria:string "What the revision must preserve or improve"'
      + ', repoContext:string "Repo-specific constraints and workflow rules"'
      + ' -> revisedSkill:string "Rewritten skill text"'
      + ', rationale:string "Short explanation of what changed and why"'
      + ', rolloutNote:string "What must be re-synced or reloaded after applying the change"',
    {
      description: "Optimize repo-owned skill instructions while preserving repo protocol, command authority, and local sync semantics.",
    },
  );
}

export function createProgram(target: "workflow"): ReturnType<typeof createWorkflowProgram>;
export function createProgram(target: "skill"): ReturnType<typeof createSkillProgram>;
export function createProgram(target: OptimizeTarget) {
  if (target === "workflow") return createWorkflowProgram();
  return createSkillProgram();
}
