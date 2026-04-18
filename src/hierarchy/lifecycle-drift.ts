import { relative } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { walkMarkdown } from "../lib/vault";
import { readVerificationLevel } from "../lib/verification";
import { projectSlicesDir } from "../lib/structure";
import { appendLogEntry } from "../lib/log";
import type { MaintenanceAction } from "../lib/diagnostics";

// ─── slice detail for R2/R3 analysis ─────────────────────────────────────────

export type SliceDetail = {
  taskId: string;
  status: string | null;
  supersededBy: string | null;
  verificationLevel: string | null;
};

export async function collectSliceDetails(project: string): Promise<{ byPrd: Map<string, SliceDetail[]>; byFeature: Map<string, SliceDetail[]> }> {
  const slicesDir = projectSlicesDir(project);
  const byPrd = new Map<string, SliceDetail[]>();
  const byFeature = new Map<string, SliceDetail[]>();
  if (!await exists(slicesDir)) return { byPrd, byFeature };
  const sliceFiles = await walkMarkdown(slicesDir);
  for (const file of sliceFiles) {
    if (!file.endsWith("/index.md")) continue;
    const relPath = relative(VAULT_ROOT, file);
    const raw = await readText(file);
    const parsed = safeMatter(relPath, raw, { silent: true });
    if (!parsed) continue;
    const taskId = typeof parsed.data.task_id === "string" ? parsed.data.task_id : null;
    if (!taskId) continue;
    const parentPrd = typeof parsed.data.parent_prd === "string" ? parsed.data.parent_prd : null;
    const parentFeature = typeof parsed.data.parent_feature === "string" ? parsed.data.parent_feature : null;
    const status = typeof parsed.data.status === "string" ? parsed.data.status : null;
    const supersededBy = typeof parsed.data.superseded_by === "string" ? parsed.data.superseded_by : null;
    const detail: SliceDetail = { taskId, status, supersededBy, verificationLevel: readVerificationLevel(parsed.data) };
    if (parentPrd) {
      if (!byPrd.has(parentPrd)) byPrd.set(parentPrd, []);
      byPrd.get(parentPrd)!.push(detail);
    }
    if (parentFeature) {
      if (!byFeature.has(parentFeature)) byFeature.set(parentFeature, []);
      byFeature.get(parentFeature)!.push(detail);
    }
  }
  return { byPrd, byFeature };
}

// ─── deterministic resolution rules (R2, R3, R4) ─────────────────────────────

const NON_TERMINAL_STATUSES = new Set(["draft", "open", "in-progress", "blocked"]);

export function buildLifecycleDriftAction(
  entityKind: "feature" | "prd",
  entityId: string,
  file: string,
  parsed: { content: string; data: Record<string, unknown> },
  slices: SliceDetail[],
  project: string,
): MaintenanceAction {
  // R2 — reopen: any child in a non-terminal state
  const nonTerminalChild = slices.find((s) => s.status !== null && NON_TERMINAL_STATUSES.has(s.status));
  if (nonTerminalChild) {
    return {
      kind: "lifecycle-reopen",
      scope: "parent",
      message: `${entityKind} ${entityId} status=complete but child ${nonTerminalChild.taskId} is ${nonTerminalChild.status} — auto-reopening`,
      _apply() {
        const { completed_at: _drop, ...rest } = parsed.data as Record<string, unknown>;
        writeNormalizedPage(file, parsed.content, {
          ...rest,
          status: "in-progress",
          reopened_reason: `child slice ${nonTerminalChild.taskId} added/reopened after completion`,
        });
        appendLogEntry("auto-heal", entityId, {
          project,
          details: [`rule=R2`, `before=complete`, `after=in-progress`, `trigger=lifecycle-reopen`, `cause=${nonTerminalChild.taskId}`, `inverse=wiki lifecycle close ${project} ${entityId} --force`],
        });
      },
    };
  }

  // R3 — cancel-cascade: all slices cancelled AND superseded_by unanimous
  if (slices.length > 0 && slices.every((s) => s.status === "cancelled")) {
    const supersededValues = slices.map((s) => s.supersededBy).filter((v): v is string => v !== null && v !== "");
    const uniqueValues = [...new Set(supersededValues)];
    if (uniqueValues.length === 1) {
      const supersededBy = uniqueValues[0]!;
      return {
        kind: "lifecycle-cancel-cascade",
        scope: "parent",
        message: `${entityKind} ${entityId} status=complete but all children cancelled (superseded_by=${supersededBy}) — auto-cancelling`,
        _apply() {
          const data = parsed.data as Record<string, unknown>;
          writeNormalizedPage(file, parsed.content, {
            ...data,
            status: "cancelled",
            superseded_by: supersededBy,
            completed_at: typeof data.completed_at === "string" ? data.completed_at : nowIso(),
          });
          appendLogEntry("auto-heal", entityId, {
            project,
            details: [`rule=R3`, `before=complete`, `after=cancelled`, `trigger=lifecycle-cancel-cascade`, `superseded_by=${supersededBy}`, `inverse=hand-edit frontmatter (un-cancel a child slice to trigger R2 on next run)`],
          });
        },
      };
    }
  }

  // R4 — escalate: ambiguous, emit warning with inverse commands
  return {
    kind: "lifecycle-escalate",
    scope: "parent",
    message: `${entityKind} ${entityId} status=complete but computed status is inconsistent — to reopen: wiki lifecycle open ${project} ${entityId} — to cancel: wiki lifecycle close ${project} ${entityId} --force`,
  };
}
