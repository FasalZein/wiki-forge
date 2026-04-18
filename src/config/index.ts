import { loadConfigDetailed, type ResolvedConfig } from "../lib/config";

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
  for (const line of warnings) console.error(line);

  if (json) {
    console.log(JSON.stringify(serialize(config), null, 2));
    return;
  }
  printText(config);
}

interface SerializedLeaf {
  value: unknown;
  source: string;
}

function serialize(config: ResolvedConfig): Record<string, Record<string, SerializedLeaf>> {
  return {
    repo: {
      ignore: { value: config.repo.ignore.value, source: config.repo.ignore.source },
    },
  };
}

function printText(config: ResolvedConfig): void {
  console.log("wiki config (effective):");
  const ignore = config.repo.ignore;
  const value = ignore.value.length ? `[${ignore.value.map((p) => JSON.stringify(p)).join(", ")}]` : "[]";
  console.log(`  repo.ignore = ${value}  (source: ${ignore.source})`);
}
