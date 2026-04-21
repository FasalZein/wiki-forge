import { loadConfig } from "./config";
import { runBaseline, runOptimization } from "./optimize";
import type { OptimizeTarget } from "./types";

function parseTarget(value: string | undefined): OptimizeTarget {
  if (value === "workflow" || value === "skill") return value;
  throw new Error("target must be one of: workflow, skill");
}

async function main() {
  const [command, rawTarget] = process.argv.slice(2);

  switch (command) {
    case "print-config":
      console.log(JSON.stringify(loadConfig(), null, 2));
      return;
    case "baseline":
      console.log(JSON.stringify(await runBaseline(parseTarget(rawTarget)), null, 2));
      return;
    case "optimize":
      console.log(JSON.stringify(await runOptimization(parseTarget(rawTarget)), null, 2));
      return;
    default:
      throw new Error("usage: bun src/cli.ts <print-config|baseline|optimize> [workflow|skill]");
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
