import { loadConfig } from "./config";
import { runBaseline, runEvaluation, runOptimization, runSkillCandidates } from "./optimize";
import { runSkillPromotion } from "./promote";
import type { OptimizeTarget } from "./types";

function printLine(line = "") {
  process.stdout.write(`${line}\n`);
}

function printJson(value: unknown) {
  printLine(JSON.stringify(value, null, 2));
}

function printError(line = "") {
  process.stderr.write(`${line}\n`);
}


function parseTarget(value: string | undefined): OptimizeTarget {
  if (value === "workflow" || value === "skill") return value;
  throw new Error("target must be one of: workflow, skill");
}

async function main() {
  const [command, rawTarget] = process.argv.slice(2);

  switch (command) {
    case "print-config":
      printJson(loadConfig());
      return;
    case "baseline":
      printJson(await runBaseline(parseTarget(rawTarget)));
      return;
    case "optimize":
      printJson(await runOptimization(parseTarget(rawTarget)));
      return;
    case "evaluate":
      printJson(await runEvaluation(parseTarget(rawTarget)));
      return;
    case "candidates":
      if (rawTarget !== "skill") throw new Error("candidates currently supports only: skill");
      printJson(await runSkillCandidates());
      return;
    case "promote":
      if (rawTarget !== "skill") throw new Error("promote currently supports only: skill");
      printJson(await runSkillPromotion(process.argv.slice(4)[0]));
      return;
    default:
      throw new Error("usage: bun src/cli.ts <print-config|baseline|optimize|evaluate> [workflow|skill] | bun src/cli.ts candidates skill | bun src/cli.ts promote skill [wiki|forge]");
  }
}

main().catch((error) => {
  printError(String(error));
  process.exit(1);
});
