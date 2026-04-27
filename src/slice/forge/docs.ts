import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { safeMatter } from "../../cli-shared";
import { exists, readText } from "../../lib/fs";
import { collectCloseout, collectGate } from "../../maintenance";
import type { DiagnosticFinding } from "../../maintenance/shared";

export type MatterDoc = { path: string; data: Record<string, unknown>; content: string };

export type ForgeReview = {
  ok: boolean;
  findings: Array<Pick<DiagnosticFinding, "scope" | "severity" | "message" | "files" | "details" | "repair">>;
  blockers: string[];
  warnings: string[];
};

export async function collectForgeReview(
  project: string,
  sliceId: string,
  repo: string | undefined,
  base: string | undefined,
  worktree: boolean,
): Promise<ForgeReview> {
  const resolvedBase = base ?? "HEAD";
  const closeout = await collectCloseout(project, resolvedBase, repo, undefined, undefined, { worktree, sliceLocal: true, sliceId });
  const gate = await collectGate(project, resolvedBase, repo, { worktree, sliceLocal: true, sliceId, precomputedCloseout: closeout });
  return {
    ok: gate.ok,
    findings: gate.findings.map((finding) => ({
      scope: finding.scope,
      severity: finding.severity,
      message: finding.message,
      ...(finding.files ? { files: finding.files } : {}),
      ...(finding.details ? { details: finding.details } : {}),
      ...(finding.repair ? { repair: finding.repair } : {}),
    })),
    blockers: gate.blockers,
    warnings: gate.warnings,
  };
}

export async function readMatter(path: string): Promise<MatterDoc | null> {
  if (!await exists(path)) return null;
  const raw = await readText(path);
  const parsed = safeMatter(relative(VAULT_ROOT, path), raw, { silent: true });
  if (!parsed) return null;
  return { path, data: parsed.data, content: parsed.content };
}

export async function readPlanningDoc(dir: string, id: string): Promise<MatterDoc | null> {
  if (!await exists(dir)) return null;
  const file = readdirSync(dir).find((entry) => entry.startsWith(`${id}-`) && entry.endsWith(".md"));
  return file ? readMatter(join(dir, file)) : null;
}

export function extractSection(markdown: string, heading: string) {
  const match = markdown.match(new RegExp(`^## ${escapeRegex(heading)}\\n([\\s\\S]*?)(?=^##\\s|$)`, "mu"));
  return match?.[1]?.trim() ?? "";
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
