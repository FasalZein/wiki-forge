import { requireValue } from "../../../cli-shared";
import { slugify as slugifyValue } from "../../../lib/slug";

export function parsePrdArgs(args: string[]) {
  const project = args[0];
  requireValue(project, "project");
  let featureId: string | undefined;
  let supersedes: string | undefined;
  let splitFrom: string | undefined;
  const nameParts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--feature":
        featureId = args[index + 1];
        index += 1;
        break;
      case "--supersedes":
        supersedes = args[index + 1];
        index += 1;
        break;
      case "--split-from":
        splitFrom = args[index + 1];
        index += 1;
        break;
      default:
        if (!arg.startsWith("--")) nameParts.push(arg);
        break;
    }
  }
  const name = nameParts.join(" ").trim();
  requireValue(featureId, "feature-id (--feature FEAT-001)");
  requireValue(name || undefined, "name");
  return { project, name, featureId, supersedes, splitFrom };
}

export function parseProjectAndName(args: string[]) {
  const project = args[0];
  const name = args.slice(1).filter((arg) => !arg.startsWith("--")).join(" ").trim();
  requireValue(project, "project");
  requireValue(name || undefined, "name");
  return { project, name };
}

export function slugify(value: string) {
  return slugifyValue(value, "spec");
}
