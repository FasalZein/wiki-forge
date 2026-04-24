import { join } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, requireValue } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { renderPromptProtocolReminders } from "../../protocol/source/index";
import { collectTaskContextForId } from "../../hierarchy";
import { defaultAgentName } from "../../lib/cli-utils";
import { firstMeaningfulLine, firstSectionLine, summarizePlan } from "../../lib/slices/plan-summary";
import { extractShellCommandBlocks } from "../../verification";
import { readSliceHub, readSlicePlan, readSliceSourcePaths, readSliceTestPlan } from "../../slice/docs";
import { printJson, printLine } from "../../lib/cli-output";

export { firstMeaningfulLine, firstSectionLine, summarizePlan };

export async function noteProject(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let agent = defaultAgentName();
  let sliceId: string | undefined;
  const messageParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--agent":
        agent = args[index + 1] || agent;
        index += 1;
        break;
      case "--slice":
        sliceId = args[index + 1] || undefined;
        index += 1;
        break;
      case "--json":
        break;
      default:
        messageParts.push(arg);
        break;
    }
  }
  const message = messageParts.join(" ").trim();
  requireValue(message || undefined, "message");
  const createdAt = nowIso();
  appendLogEntry("note", message, {
    project,
    details: [`agent=${agent}`, ...(sliceId ? [`slice=${sliceId}`] : []), `at=${createdAt}`],
  });
  const result = { project, agent, sliceId, message, createdAt };
  if (args.includes("--json")) printJson(result);
  else printLine(`noted for ${project}: ${message}`);
}

export async function exportPrompt(args: string[]) {
  const project = args[0];
  const sliceId = args[1];
  requireValue(project, "project");
  requireValue(sliceId, "slice-id");
  const agentIndex = args.indexOf("--agent");
  const agent = (agentIndex >= 0 ? args[agentIndex + 1] : "codex") || "codex";
  if (!["codex", "claude", "pi"].includes(agent)) throw new Error(`unsupported agent: ${agent}`);
  const summaryPath = join(VAULT_ROOT, "projects", project, "_summary.md");
  const [hub, plan, testPlan, summary, sourcePaths] = await Promise.all([
    readSliceHub(project, sliceId),
    readSlicePlan(project, sliceId),
    readSliceTestPlan(project, sliceId),
    exists(summaryPath).then((e) => e ? readText(summaryPath) : ""),
    readSliceSourcePaths(project, sliceId),
  ]);
  const commands = extractShellCommandBlocks(testPlan.content);
  const context = await collectTaskContextForId(project, sliceId);
  const prompt = renderExecutionPrompt({ project, sliceId, agent, hub, plan, testPlan, summary, sourcePaths, commands, context });
  printLine(prompt);
}

export function renderExecutionPrompt(input: {
  project: string;
  sliceId: string;
  agent: string;
  hub: Awaited<ReturnType<typeof readSliceHub>>;
  plan: Awaited<ReturnType<typeof readSlicePlan>>;
  testPlan: Awaited<ReturnType<typeof readSliceTestPlan>>;
  summary: string;
  sourcePaths: string[];
  commands: string[];
  context: Awaited<ReturnType<typeof collectTaskContextForId>>;
}) {
  const title = typeof input.hub.data.title === "string" ? input.hub.data.title : input.sliceId;
  const assignee = typeof input.hub.data.assignee === "string" ? input.hub.data.assignee : null;
  const summaryBody = input.summary.replace(/^---[\s\S]*?---\s*/u, "").trim();
  const protocolReminders = renderPromptProtocolReminders(input.project);
  const baseSections = [
    `Task: ${title}`,
    `Project: ${input.project}`,
    assignee ? `Intended assignee: ${assignee}` : null,
    "",
    "Context:",
    summaryBody ? summaryBody.slice(0, 1200) : "- Read projects/_summary first.",
    "",
    "Slice Hub:",
    input.hub.content.trim(),
    "",
    "Execution Plan:",
    input.plan.content.trim(),
    "",
    "Test Plan:",
    input.testPlan.content.trim(),
    "",
    "Source Paths:",
    ...(input.sourcePaths.length ? input.sourcePaths.map((path) => `- ${path}`) : ["- none bound yet"]),
    "",
    "Verification:",
    ...(input.commands.length ? input.commands.map((command) => `- ${command}`) : ["- Fill verification commands before implementation ends."]),
    "",
    "Protocol reminders:",
    ...protocolReminders.map((line) => `- ${line}`),
    "",
    "Rules:",
    "- Do not write ad hoc markdown into the project repo.",
    "- Keep changes scoped to this slice.",
    "- Update tests with code unless this is an explicit structural refactor.",
    "- Run the listed verification commands before handing back.",
  ].filter((line): line is string => line !== null);

  if (input.agent === "claude") {
    return [
      "You are continuing an in-flight wiki-forge slice.",
      "Stay within the described slice boundary and finish implementation plus verification.",
      "",
      ...baseSections,
      "",
      "Deliverable:",
      "- Return a concise summary of code changes, tests run, and any wiki follow-up required.",
    ].join("\n");
  }

  if (input.agent === "pi") {
    return [
      "You are pi continuing a tracked wiki-forge slice.",
      "Operate directly in the repo, keep changes inside the slice boundary, and finish with verification.",
      "",
      ...baseSections,
      "",
      "Pi-specific expectations:",
      "- Read the referenced files before editing them.",
      "- Keep the repo clean and avoid ad hoc markdown in the project repo.",
      "- Report the exact verification commands you ran.",
    ].join("\n");
  }

  return [
    "Implement this slice in the repo and stop only after tests/verification are done.",
    "Use the provided plan/test-plan as the contract.",
    "",
    ...baseSections,
    "",
    "Output format:",
    "- summary of files changed",
    "- verification commands run + results",
    "- follow-up blockers, if any",
  ].join("\n");
}
