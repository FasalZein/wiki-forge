import { fail } from "../../cli-shared";
import { parseProjectRepoArgs } from "../../git-utils";
import { loadProjectSnapshot } from "../shared";
import { printJson, printLine } from "../../lib/cli-output";

export async function lintRepo(args: string[]) {
  const options = parseProjectRepoArgs(args);
  const json = args.includes("--json");
  const snapshot = await loadProjectSnapshot(options.project, options.repo, { includeRepoInventory: true });
  const violations = snapshot.repoDocFiles ?? [];
  const result = { project: options.project, repo: snapshot.repo, ok: violations.length === 0, violations };
  if (json) printJson(result);
  else {
    printLine(`lint-repo for ${options.project}: ${result.ok ? "PASS" : "FAIL"}`);
    printLine(`- violations: ${violations.length}`);
    for (const violation of violations.slice(0, 50)) printLine(`  - ${violation}`);
  }
  if (!result.ok) fail(`lint-repo found ${violations.length} disallowed repo markdown file(s) for ${options.project}`);
}
