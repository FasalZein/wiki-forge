import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { requireValue } from "../../cli-shared";
import { appendLogEntry } from "../../lib/log";
import { appendTaskToBacklog, moveTaskToSection, parseTaskArgs } from "./io";
import { collectBacklogView } from "./collect";
import type { BacklogTaskContext } from "./collect";

export async function backlogCommand(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  const json = args.includes("--json");
  const assigneeIndex = args.indexOf("--assignee");
  const assignee = assigneeIndex >= 0 ? args[assigneeIndex + 1] : undefined;
  if (assigneeIndex >= 0) requireValue(assignee, "assignee");
  const result = await collectBacklogView(project, assignee);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printBacklogSummary(result.sections, assignee);
}

export async function addTask(args: string[]) {
  const options = parseTaskArgs(args);
  const appended = await appendTaskToBacklog(options);
  appendLogEntry("add-task", options.title, { project: options.project, details: [`task=${appended.taskId}`, `section=${options.section}`] });
  const result = {
    project: options.project,
    taskId: appended.taskId,
    section: options.section,
    title: options.title,
    backlogPath: relative(VAULT_ROOT, appended.backlogPath),
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`added ${appended.taskId} to ${relative(VAULT_ROOT, appended.backlogPath)} (${options.section})`);
}

export async function moveTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  const toIndex = args.indexOf("--to");
  const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  requireValue(to, "to");
  await moveTaskToSection(project, taskId, to);
  console.log(`moved ${taskId} -> ${to}`);
}

export async function completeTask(args: string[]) {
  const project = args[0];
  const taskId = args[1];
  requireValue(project, "project");
  requireValue(taskId, "task-id");
  await moveTaskToSection(project, taskId, "Done");
  console.log(`moved ${taskId} -> Done`);
}

function printBacklogSummary(sections: Record<string, BacklogTaskContext[]>, assignee?: string) {
  if (assignee) console.log(`assignee filter: ${assignee}`);
  for (const [section, items] of Object.entries(sections)) {
    console.log(`${section}: ${items.length}`);
    for (const item of items.slice(0, 20)) {
      const suffix = [item.assignee ? `assignee=${item.assignee}` : null, item.blockedBy.length ? `blocked by ${item.blockedBy.join(", ")}` : null, item.sliceStatus ? `status=${item.sliceStatus}` : null].filter(Boolean).join(" | ");
      console.log(`- ${item.id} ${item.title}${suffix ? ` | ${suffix}` : ""}`);
    }
  }
}
