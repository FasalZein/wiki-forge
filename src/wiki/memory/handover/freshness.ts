import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export type HandoverStaleness =
  | { readonly status: "not-stale" }
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "stale"; readonly promptHead: string; readonly currentHead: string };

export function detectHandoverPromptStaleness(copyPastePrompt: string, repo: string): HandoverStaleness {
  const promptHead = readPromptHead(copyPastePrompt);
  if (!promptHead) return { status: "not-stale" };
  const currentHead = readGitHead(repo);
  if (!currentHead) return { status: "unknown", reason: "current HEAD unavailable" };
  if (currentHead.startsWith(promptHead) || promptHead.startsWith(currentHead)) return { status: "not-stale" };
  return { status: "stale", promptHead, currentHead };
}

export function renderHandoverRecoveryPrompt(input: {
  readonly project: string;
  readonly repo: string;
  readonly currentHead: string;
}): string {
  return [
    `Continue ${input.project} from current HEAD ${input.currentHead}.`,
    "",
    "First run:",
    `wiki resume ${input.project} --repo ${input.repo} --base HEAD`,
    `wiki checkpoint ${input.project} --repo ${input.repo} --base HEAD --json`,
    `wiki forge next ${input.project} --repo ${input.repo} --json`,
    "",
    "Treat older handover prompts as historical context only if they name a different HEAD/base.",
  ].join("\n");
}

function readPromptHead(copyPastePrompt: string): string | null {
  const match = /\b(?:HEAD|base)\s+([0-9a-f]{7,40})\b/iu.exec(copyPastePrompt);
  return match?.[1] ?? null;
}

function readGitHead(repo: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(repo),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}
