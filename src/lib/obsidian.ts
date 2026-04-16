import { resolveCommandOnPath } from "./runtime";

export async function assertObsidianCliAvailable() {
  if (await resolveCommandOnPath("obsidian")) return;
  throw new Error(
    "obsidian CLI not found. Install/enable Obsidian CLI in the Obsidian app, restart your terminal, and ensure 'obsidian' is on PATH.",
  );
}

export async function runObsidian(args: string[]) {
  await assertObsidianCliAvailable();
  const proc = Bun.spawnSync(["obsidian", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`obsidian ${args[0]} failed with exit code ${proc.exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  }
  return { stdout, stderr };
}
