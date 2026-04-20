import { requireValue } from "../cli-shared";
import { readFlagValue } from "../lib/cli-utils";
import { collectBacklogFocus } from "../hierarchy";

export type ForgeMode = "start" | "check" | "close" | "status" | "run";

export type ParsedForgeArgs = {
  project: string;
  sliceId: string;
  passthrough: string[];
  repo?: string;
  base?: string;
  json: boolean;
  dryRun: boolean;
  worktree: boolean;
};

export async function parseForgeArgs(args: string[], mode: ForgeMode): Promise<ParsedForgeArgs> {
  const { positional, passthrough } = splitForgeArgs(args);
  const project = positional[0];
  requireValue(project, "project");
  const explicitSliceId = positional[1];
  const sliceId = await resolveForgeSliceId(project, explicitSliceId, mode);
  const repo = readFlagValue(passthrough, "--repo");
  const base = readFlagValue(passthrough, "--base");
  const json = passthrough.includes("--json");
  const dryRun = passthrough.includes("--dry-run");
  const worktree = passthrough.includes("--worktree") || (!base && mode !== "start");
  return { project, sliceId, passthrough, repo, base, json, dryRun, worktree };
}

function splitForgeArgs(args: string[]) {
  const positional: string[] = [];
  const passthrough: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      passthrough.push(arg);
      if (flagTakesValue(arg) && index + 1 < args.length) {
        passthrough.push(args[index + 1]);
        index += 1;
      }
      continue;
    }
    if (positional.length < 2) positional.push(arg);
    else passthrough.push(arg);
  }
  return { positional, passthrough };
}

function flagTakesValue(flag: string) {
  return flag === "--agent" || flag === "--repo" || flag === "--base";
}

async function resolveForgeSliceId(project: string, explicitSliceId: string | undefined, mode: ForgeMode) {
  if (explicitSliceId) return explicitSliceId;
  const focus = await collectBacklogFocus(project);
  const candidate = mode === "start"
    ? focus.recommendedTask?.id ?? focus.activeTask?.id
    : focus.activeTask?.id ?? focus.recommendedTask?.id;
  requireValue(candidate, "slice-id");
  return candidate;
}
