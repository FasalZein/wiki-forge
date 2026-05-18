import { printJson, printLine } from "../../lib/cli-output";
import { requireValue } from "../../cli-shared";
import { amendForgeSlice, checkForgeSliceClose, closeForgeSlice, releaseForgeSlice, startForgeSlice } from "../vault/slice-store";
import { loadForgeProjectProjection } from "../vault/load-project";
import { renderForgeNextJson, renderForgeNextText } from "./render-next";
import { readFlagValue, readPositionalArgs } from "./arg-utils";

export async function forgeStartCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agent = readFlagValue(args, "--agent") ?? "agent";
  const result = await startForgeSlice({ project, sliceId, agent });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `started ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeReleaseCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const result = await releaseForgeSlice({ project, sliceId });
  if (json) printJson(result);
  else printLine(`released ${sliceId}`);
}

export async function forgeAmendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const options = parseAmendArgs(args);
  const result = await amendForgeSlice(options);
  if (json) printJson(result);
  else printLine(`created amendment ${result.amendmentSliceId} for ${result.closedSliceId}`);
}

export async function forgeCheckCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await checkForgeSliceClose({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `check passed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeCloseCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const closedBy = readFlagValue(args, "--closed-by") ?? readFlagValue(args, "--agent") ?? "agent";
  const result = await closeForgeSlice({ project, sliceId, closedBy });
  if (json) printJson(result);
  else printLine(result.status === "accepted" ? `closed ${sliceId}` : `rejected ${result.rejection.code}`);
  if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
}

export async function forgeRunCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = readPositionalArgs(args, ["--agent", "--closed-by"]);
  const project = positional[0];
  const sliceId = positional[1];
  requireValue(project, "project");
  const agent = readFlagValue(args, "--agent") ?? readFlagValue(args, "--closed-by") ?? "agent";
  if (sliceId) {
    await forgeCloseCommand(args);
    return;
  }

  const projection = await loadForgeProjectProjection(project);
  if (projection.status === "active") {
    const result = await closeForgeSlice({ project, sliceId: projection.activeSliceId, closedBy: agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `closed ${projection.activeSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (projection.status === "ready") {
    const result = await startForgeSlice({ project, sliceId: projection.nextSliceId, agent });
    if (json) printJson(result);
    else printLine(result.status === "accepted" ? `started ${projection.nextSliceId}` : `rejected ${result.rejection.code}`);
    if (result.status === "rejected") throw Object.assign(new Error(result.rejection.reason), { exitCode: 1 });
    return;
  }
  if (json) printLine(renderForgeNextJson(projection));
  else printLine(renderForgeNextText(projection));
  if (projection.status === "conflict" || projection.status === "needs-repair") throw Object.assign(new Error(`cannot run ${project}: ${projection.status}`), { exitCode: 1 });
}

function parseAmendArgs(args: readonly string[]) {
  const positional: string[] = [];
  const sourcePaths: string[] = [];
  let reason: string | undefined;
  let title: string | undefined;
  let agent: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--reason":
        reason = args[index + 1];
        index += 1;
        break;
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--source":
        while (args[index + 1] && !args[index + 1]?.startsWith("--")) {
          sourcePaths.push(String(args[index + 1]).replaceAll("\\", "/"));
          index += 1;
        }
        break;
      case "--json":
      case "--start":
        break;
      default:
        if (!arg.startsWith("--")) positional.push(arg);
        break;
    }
  }
  const project = positional[0];
  const closedSliceId = positional[1];
  requireValue(project, "project");
  requireValue(closedSliceId, "closed-slice-id");
  requireValue(reason, "--reason");
  return {
    project,
    closedSliceId,
    reason,
    ...(title ? { title } : {}),
    ...(agent ? { agent } : {}),
    sourcePaths,
    start: args.includes("--start"),
  };
}
