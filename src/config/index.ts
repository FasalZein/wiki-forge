import { loadConfigDetailed, type ResolvedConfig } from "../lib/config";
import { printError, printJson, printLine } from "../lib/cli-output";

export async function configCommand(args: string[]): Promise<void> {
  const effective = args.includes("--effective");
  if (!effective) {
    throw new Error("wiki config requires --effective. Usage: wiki config --effective [--json] [--repo <path>]");
  }
  const json = args.includes("--json");
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : process.cwd();
  if (repoIndex >= 0 && !repo) throw new Error("missing value for --repo");

  const { config, warnings } = loadConfigDetailed(repo);
  for (const line of warnings) printError(line);

  if (json) {
    printJson(serialize(config));
    return;
  }
  printText(config);
}

interface SerializedLeaf {
  value: unknown;
  source: string;
}

function serialize(config: ResolvedConfig) {
  return {
    repo: {
      ignore: { value: config.repo.ignore.value, source: config.repo.ignore.source },
    },
    workflow: {
      phaseSkills: {
        research: { value: config.workflow.phaseSkills.research.value, source: config.workflow.phaseSkills.research.source },
        domainModel: { value: config.workflow.phaseSkills.domainModel.value, source: config.workflow.phaseSkills.domainModel.source },
        prd: { value: config.workflow.phaseSkills.prd.value, source: config.workflow.phaseSkills.prd.source },
        slices: { value: config.workflow.phaseSkills.slices.value, source: config.workflow.phaseSkills.slices.source },
        tdd: { value: config.workflow.phaseSkills.tdd.value, source: config.workflow.phaseSkills.tdd.source },
        verify: { value: config.workflow.phaseSkills.verify.value, source: config.workflow.phaseSkills.verify.source },
      },
    },
  };
}

function printText(config: ResolvedConfig): void {
  printLine("wiki config (effective):");
  const ignore = config.repo.ignore;
  const value = ignore.value.length ? `[${ignore.value.map((p) => JSON.stringify(p)).join(", ")}]` : "[]";
  printLine(`  repo.ignore = ${value}  (source: ${ignore.source})`);
  printLine(`  workflow.phaseSkills.research = ${JSON.stringify(config.workflow.phaseSkills.research.value)}  (source: ${config.workflow.phaseSkills.research.source})`);
  printLine(`  workflow.phaseSkills.domainModel = ${JSON.stringify(config.workflow.phaseSkills.domainModel.value)}  (source: ${config.workflow.phaseSkills.domainModel.source})`);
  printLine(`  workflow.phaseSkills.prd = ${JSON.stringify(config.workflow.phaseSkills.prd.value)}  (source: ${config.workflow.phaseSkills.prd.source})`);
  printLine(`  workflow.phaseSkills.slices = ${JSON.stringify(config.workflow.phaseSkills.slices.value)}  (source: ${config.workflow.phaseSkills.slices.source})`);
  printLine(`  workflow.phaseSkills.tdd = ${JSON.stringify(config.workflow.phaseSkills.tdd.value)}  (source: ${config.workflow.phaseSkills.tdd.source})`);
  printLine(`  workflow.phaseSkills.verify = ${JSON.stringify(config.workflow.phaseSkills.verify.value)}  (source: ${config.workflow.phaseSkills.verify.source})`);
}
