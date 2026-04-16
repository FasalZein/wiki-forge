import { runObsidian } from "../lib/obsidian";

function noteTargetArgs(note: string) {
  return note.includes("/") || note.endsWith(".md") ? [`path=${note.endsWith(".md") ? note : `${note}.md`}`] : [`file=${note}`];
}

export async function obsidianCommand(args: string[]) {
  const subcommand = args[0];
  if (!subcommand) throw new Error("missing obsidian subcommand");

  if (subcommand === "open") {
    const note = args[1];
    if (!note) throw new Error("missing note");
    await runObsidian(["open", ...noteTargetArgs(note)]);
    console.log(`opened ${note} in Obsidian`);
    return;
  }

  if (subcommand === "backlinks") {
    const note = args[1];
    if (!note) throw new Error("missing note");
    const json = args.includes("--json");
    const result = await runObsidian(["backlinks", ...noteTargetArgs(note), ...(json ? ["format=json"] : [])]);
    process.stdout.write(result.stdout);
    return;
  }

  if (subcommand === "unresolved") {
    const json = args.includes("--json");
    const result = await runObsidian(["unresolved", ...(json ? ["format=json"] : [])]);
    process.stdout.write(result.stdout);
    return;
  }

  if (subcommand === "orphans") {
    const result = await runObsidian(["orphans"]);
    process.stdout.write(result.stdout);
    return;
  }

  if (subcommand === "deadends") {
    const result = await runObsidian(["deadends"]);
    process.stdout.write(result.stdout);
    return;
  }

  if (subcommand === "property:set") {
    const note = args[1];
    const name = args[2];
    const value = args.slice(3).join(" ").trim();
    if (!note) throw new Error("missing note");
    if (!name) throw new Error("missing property name");
    if (!value) throw new Error("missing property value");
    await runObsidian(["property:set", ...noteTargetArgs(note), `name=${name}`, `value=${value}`]);
    console.log(`updated ${note} property ${name}`);
    return;
  }

  throw new Error(`unknown obsidian subcommand: ${subcommand}`);
}
