import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exists, readText } from "../../lib/fs";

const ENV_LINE = 'export KNOWLEDGE_VAULT_ROOT="$HOME/Knowledge"';
const COMMENT = "# Wiki CLI vault root";

export async function setupShell(args: string[]) {
  const vaultPath = args[0] || join(homedir(), "Knowledge");
  const shell = process.env.SHELL ?? "/bin/zsh";
  const rcFile = await resolveRcFile(shell);

  if (!rcFile) {
    console.error(`error: unsupported shell: ${shell}`);
    console.log(`manually add to your shell config:\n  export KNOWLEDGE_VAULT_ROOT="${vaultPath}"`);
    process.exit(1);
  }

  const rcPath = join(homedir(), rcFile);
  const exportLine = `export KNOWLEDGE_VAULT_ROOT="${vaultPath}"`;

  if (await exists(rcPath)) {
    const content = await readText(rcPath);
    if (content.includes("KNOWLEDGE_VAULT_ROOT")) {
      console.log(`KNOWLEDGE_VAULT_ROOT already set in ~/${rcFile}`);
      return;
    }
  }

  appendFileSync(rcPath, `\n${COMMENT}\n${exportLine}\n`, "utf8");
  console.log(`added to ~/${rcFile}:`);
  console.log(`  ${exportLine}`);
  console.log(`\nreload with: source ~/${rcFile}`);
}

async function resolveRcFile(shell: string): Promise<string | null> {
  if (shell.endsWith("/zsh")) return ".zshrc";
  if (shell.endsWith("/bash")) {
    // macOS uses .bash_profile for login shells, Linux uses .bashrc
    const profile = join(homedir(), ".bash_profile");
    return (await exists(profile)) ? ".bash_profile" : ".bashrc";
  }
  if (shell.endsWith("/fish")) return ".config/fish/config.fish";
  return null;
}
