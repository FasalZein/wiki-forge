import type { AskOptions } from "../../types";

export const DEFAULT_ASK_MAX_RESULTS = 4;

export function parseAskOptions(args: string[]): AskOptions {
  let expand = false;
  let useBm25 = false;
  let verbose = false;
  let json = false;
  let maxResults = DEFAULT_ASK_MAX_RESULTS;
  let slug: string | undefined;
  let project: string | undefined;
  const questionParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--expand") {
      expand = true;
      continue;
    }
    if (arg === "--bm25") {
      useBm25 = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "-n" || arg === "--max-results") {
      const value = args[index + 1];
      if (!value) throw new Error(`missing ${arg} value`);
      maxResults = parsePositiveInteger(value, arg);
      index += 1;
      continue;
    }
    if (arg === "--slug") {
      const value = args[index + 1];
      if (!value) throw new Error("missing slug");
      slug = slugify(value);
      index += 1;
      continue;
    }
    if (!project) {
      project = arg;
      continue;
    }
    questionParts.push(arg);
  }

  if (!project) throw new Error("missing project");
  const question = questionParts.join(" ").trim().replace(/\s+/g, " ");
  if (!question) throw new Error("missing question");
  return { project, question, expand, bm25: useBm25, verbose, json, maxResults, slug };
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}: ${value}`);
  return parsed;
}

function slugify(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return truncate(normalized || "answer", 72).replace(/[^a-z0-9-]+/g, "");
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
