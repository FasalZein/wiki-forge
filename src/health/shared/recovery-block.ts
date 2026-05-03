export function renderHealthRecoveryBlock(commands: readonly string[]): readonly string[] {
  if (commands.length === 0) throw new Error("health recovery block requires at least one command");
  return [
    "Recovery:",
    "```bash",
    ...commands,
    "```",
  ];
}
