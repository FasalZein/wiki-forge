import { requireValue } from "../cli-shared";
import { appendLogEntry, tailLog } from "../lib/log";
import { printLine } from "../lib/cli-output";

export async function logCommand(args: string[]) {
  const subcommand = args[0] ?? "tail";
  if (subcommand === "append") {
    const kind = args[1];
    const title = args[2];
    requireValue(kind, "kind");
    requireValue(title, "title");
    const projectIndex = args.indexOf("--project");
    const detailsIndex = args.indexOf("--details");
    appendLogEntry(kind, title, {
      project: projectIndex >= 0 ? args[projectIndex + 1] : undefined,
      details: detailsIndex >= 0 ? [args.slice(detailsIndex + 1).join(" ").trim()].filter(Boolean) : [],
    });
    return printLine(`appended log entry: ${kind} | ${title}`);
  }
  let count: number;
  if (subcommand === "tail") {
    count = Number.parseInt(args[1] ?? "10", 10);
  } else {
    count = 10;
  }
  for (const entry of await tailLog(Number.isFinite(count) && count > 0 ? count : 10)) printLine(`${entry}\n`);
}
