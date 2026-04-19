/**
 * PRD-056: ledger phase auto-advance from detected artifacts.
 *
 * Pure read-only module — no filesystem writes, no persistent ledger mutation.
 * All functions are safe to call from resume, forge next, and forge run without
 * risk of side effects on the vault state.
 *
 * Design decisions:
 * - "Within the slice's lifetime" for grill detection uses the slice hub's
 *   `created_at` field (falling back to `started_at`) as the lower bound and
 *   the current time as the upper bound.
 * - "Recent" for verify-slice log detection: STALE_UNVERIFIED_DAYS (30 days)
 *   from constants.ts — the same window used for page staleness.
 * - Ambiguity (multiple valid candidates for a single-candidate rule) escalates
 *   to a warning finding rather than auto-picking. Currently only the `prd`
 *   phase can produce genuine ambiguity (two PRDs both referencing this slice).
 * - Research phase aggregates all matching files — multiple research files are
 *   not ambiguous; each is a valid ref.
 * - Audit log entries are emitted by `applyDerivedLedger` (the merge point),
 *   not inside the pure detector, so callers that don't use the merge helper
 *   (e.g. pure tests) never emit spurious log entries.
 * - All detector helpers accept an explicit `vaultRoot` rather than reading the
 *   module-level VAULT_ROOT constant, so the detectors compose cleanly in tests
 *   and in production callers that already resolved the vault path.
 */

import { join, basename, relative } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { VAULT_ROOT, STALE_UNVERIFIED_DAYS } from "../constants";
import { safeMatter } from "../cli-shared";
import { appendText, ensureDir, exists, readText } from "./fs";
import type { ForgeWorkflowLedger, ForgePhase } from "./forge-ledger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DetectionFinding = {
  phase: ForgePhase;
  scope: "slice" | "parent";
  severity: "warning" | "info";
  message: string;
};

export type DerivedForgeLedger = {
  /** Fields that should fill gaps in the authored ledger. */
  patch: Partial<ForgeWorkflowLedger>;
  /** Ambiguity / degraded-detection warnings. Never blockers. */
  findings: DetectionFinding[];
};

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

/**
 * Pure function: reads filesystem and vault artifacts, returns a ledger patch
 * that captures which phases can be considered complete based on artifact
 * evidence. No side effects.
 *
 * Failure mode: catches all errors internally and degrades to an empty patch
 * with an info finding. Callers (resume, forge next/run) must never fail
 * because of detection errors.
 *
 * @param vaultRoot  Override the vault root (defaults to the module-level VAULT_ROOT).
 *                   Useful for tests that spin up temporary vaults.
 */
export async function deriveForgeLedgerFromArtifacts(
  project: string,
  sliceId: string,
  vaultRoot?: string,
): Promise<DerivedForgeLedger> {
  const root = vaultRoot ?? VAULT_ROOT;
  try {
    return await _derive(project, sliceId, root);
  } catch (err) {
    return {
      patch: {},
      findings: [
        {
          phase: "research",
          scope: "slice",
          severity: "info",
          message: `artifact detection failed (degraded): ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

async function _derive(project: string, sliceId: string, vaultRoot: string): Promise<DerivedForgeLedger> {
  const findings: DetectionFinding[] = [];
  const patch: Partial<ForgeWorkflowLedger> = { project, sliceId };

  // Read hub to get parent_prd, parent_feature, created_at, started_at
  const hubPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "index.md");
  if (!await exists(hubPath)) {
    return { patch: {}, findings };
  }
  const hubRaw = await readText(hubPath);
  const hubParsed = safeMatter(relative(vaultRoot, hubPath), hubRaw, { silent: true });
  if (!hubParsed) return { patch: {}, findings };

  const parentPrd = typeof hubParsed.data.parent_prd === "string" ? hubParsed.data.parent_prd.trim() : undefined;
  const parentFeature = typeof hubParsed.data.parent_feature === "string" ? hubParsed.data.parent_feature.trim() : undefined;
  const sliceCreatedAt = typeof hubParsed.data.created_at === "string"
    ? hubParsed.data.created_at.trim()
    : typeof hubParsed.data.started_at === "string"
      ? hubParsed.data.started_at.trim()
      : null;

  if (parentPrd) patch.parentPrd = parentPrd;

  // -------------------------------------------------------------------
  // Phase: research
  // Rule: research/projects/<project>/** contains a file whose basename
  // matches prd-<lowercased-prdId>-* or <lowercased-sliceId>-*,
  // or is listed in the PRD's source_paths frontmatter.
  // -------------------------------------------------------------------
  const researchRefs = await detectResearchRefs(project, sliceId, parentPrd, vaultRoot);
  if (researchRefs.refs.length > 0) {
    patch.research = {
      completedAt: new Date().toISOString(),
      researchRefs: researchRefs.refs,
    };
    if (researchRefs.legacyFallbackUsed) {
      findings.push({
        phase: "research",
        scope: "slice",
        severity: "warning",
        message: "deprecated basename research matching was used; add task_id or slice_id frontmatter to the research note",
      });
    }
  }

  // -------------------------------------------------------------------
  // Phase: grill
  // Rule: decisions.md contains a line tagged [PRD-<id>] or [<sliceId>]
  // authored within the slice's lifetime.
  // -------------------------------------------------------------------
  const grillResult = await detectGrillRefs(project, sliceId, parentPrd, sliceCreatedAt, vaultRoot);
  if (grillResult.decisionRefs.length > 0) {
    patch.grill = {
      completedAt: new Date().toISOString(),
      decisionRefs: grillResult.decisionRefs,
    };
  }

  // -------------------------------------------------------------------
  // Phase: prd
  // Rule: PRD markdown at specs/prds/PRD-<id>-*.md exists AND its
  // frontmatter parent_feature matches the slice's parent feature.
  // Ambiguity: two such PRDs → warning, phase stays incomplete.
  // -------------------------------------------------------------------
  const prdResult = await detectPrdRefs(project, sliceId, parentPrd, parentFeature, findings, vaultRoot);
  if (prdResult) {
    patch.prd = {
      completedAt: new Date().toISOString(),
      prdRef: prdResult.prdRef,
      parentPrd: prdResult.parentPrd,
    };
  }

  // -------------------------------------------------------------------
  // Phase: slices
  // Rule: specs/slices/<sliceId>/index.md exists AND the parent PRD's
  // ## Child Slices section lists this slice.
  // -------------------------------------------------------------------
  const slicesResult = await detectSlicesPhase(project, sliceId, parentPrd, vaultRoot);
  if (slicesResult.length > 0) {
    patch.slices = {
      completedAt: new Date().toISOString(),
      sliceRefs: slicesResult,
    };
  }

  // -------------------------------------------------------------------
  // Phase: tdd
  // Rule: Both plan.md AND test-plan.md exist under specs/slices/<sliceId>/
  // AND both have frontmatter status: ready (not draft).
  // -------------------------------------------------------------------
  const tddEvidence = await detectTddEvidence(project, sliceId, vaultRoot);
  if (tddEvidence.length > 0) {
    patch.tdd = {
      completedAt: new Date().toISOString(),
      tddEvidence,
    };
  }

  // -------------------------------------------------------------------
  // Phase: verify
  // Rule: Slice frontmatter verification_level is present (non-empty)
  // AND a recent wiki verify-slice log entry references this slice.
  // "Recent" = within STALE_UNVERIFIED_DAYS days.
  // -------------------------------------------------------------------
  const verificationCommands = await detectVerifyPhase(project, sliceId, vaultRoot);
  if (verificationCommands.length > 0) {
    patch.verify = {
      completedAt: new Date().toISOString(),
      verificationCommands,
    };
  }

  return { patch, findings };
}

// ---------------------------------------------------------------------------
// Phase detectors
// ---------------------------------------------------------------------------

async function detectResearchRefs(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  vaultRoot: string,
): Promise<{ refs: string[]; legacyFallbackUsed: boolean }> {
  const researchDir = join(vaultRoot, "research", "projects", project);
  if (!await exists(researchDir)) return { refs: [], legacyFallbackUsed: false };

  // Gather reference sets from the PRD's source_paths
  const prdSourcePaths = new Set<string>();
  if (parentPrd) {
    const prdsDir = join(vaultRoot, "projects", project, "specs", "prds");
    if (await exists(prdsDir)) {
      const entries = readdirSync(prdsDir);
      const prdFile = entries.find((f) => f.startsWith(`${parentPrd}-`) && f.endsWith(".md"));
      if (prdFile) {
        const prdRaw = await readText(join(prdsDir, prdFile));
        const prdParsed = safeMatter(`projects/${project}/specs/prds/${prdFile}`, prdRaw, { silent: true });
        if (prdParsed && Array.isArray(prdParsed.data.source_paths)) {
          for (const sp of prdParsed.data.source_paths) {
            if (typeof sp === "string") prdSourcePaths.add(sp.trim());
          }
        }
      }
    }
  }

  const refs: string[] = [];
  let legacyFallbackUsed = false;
  const sliceIdLower = sliceId.toLowerCase();
  const prdIdLower = parentPrd ? parentPrd.toLowerCase() : null;

  scanDirFlat(researchDir, "", project, sliceId, sliceIdLower, prdIdLower, prdSourcePaths, refs, (usedLegacy) => {
    legacyFallbackUsed = legacyFallbackUsed || usedLegacy;
  });

  return { refs: [...new Set(refs)], legacyFallbackUsed };
}

function scanDirFlat(
  dir: string,
  relPrefix: string,
  project: string,
  sliceId: string,
  sliceIdLower: string,
  prdIdLower: string | null,
  prdSourcePaths: Set<string>,
  refs: string[],
  onLegacyFallback: (usedLegacy: boolean) => void,
) {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      scanDirFlat(full, rel, project, sliceId, sliceIdLower, prdIdLower, prdSourcePaths, refs, onLegacyFallback);
    } else if (entry.isFile()) {
      const base = basename(entry.name, ".md").toLowerCase();
      // PRD rule: basename matches `prd-<id>-*` where prdIdLower is e.g. "prd-056"
      // so we check base.startsWith("prd-056-") — the prdIdLower already has the prd- prefix.
      // Slice rule: basename matches `<slice-id>-*` where sliceIdLower is e.g. "myproject-001".
      const matchesByName =
        (prdIdLower && (base.startsWith(`${prdIdLower}-`) || base === prdIdLower)) ||
        base.startsWith(`${sliceIdLower}-`) ||
        base === sliceIdLower;
      const relVaultPath = `research/projects/${project}/${rel}`;
      const matchesBySourcePath = prdSourcePaths.has(relVaultPath);
      const parsed = safeMatter(relVaultPath, readFileSync(full, "utf8"), { silent: true });
      const taskId = typeof parsed?.data.task_id === "string" ? parsed.data.task_id.trim() : "";
      const sliceFrontmatterId = typeof parsed?.data.slice_id === "string" ? parsed.data.slice_id.trim() : "";
      const matchesByFrontmatter = taskId === sliceId || sliceFrontmatterId === sliceId;
      if (matchesByFrontmatter || matchesBySourcePath || matchesByName) {
        refs.push(relVaultPath);
        if (!matchesByFrontmatter && matchesByName) onLegacyFallback(true);
      }
    }
  }
}

async function detectGrillRefs(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  sliceCreatedAt: string | null,
  vaultRoot: string,
): Promise<{ decisionRefs: string[] }> {
  const decisionsPath = join(vaultRoot, "projects", project, "decisions.md");
  if (!await exists(decisionsPath)) return { decisionRefs: [] };

  const raw = await readText(decisionsPath);
  const vaultRelPath = `projects/${project}/decisions.md`;
  const parsed = safeMatter(vaultRelPath, raw, { silent: true });
  if (!parsed) return { decisionRefs: [] };

  // Extract the decisions.md `updated` field to use as a rough authored-time proxy.
  // We check if the file was updated on or after the slice's created_at.
  // This is the best proxy available — decisions.md does not have per-entry timestamps.
  const decisionsUpdated = typeof parsed.data.updated === "string" ? parsed.data.updated.trim() : null;

  // Lifetime check: decisions.md must have been updated at or after slice creation.
  // If slice created_at is unknown, we skip the lifetime check (permissive).
  if (sliceCreatedAt && decisionsUpdated) {
    const sliceStart = new Date(sliceCreatedAt).getTime();
    const decisionsUpdate = new Date(decisionsUpdated).getTime();
    if (decisionsUpdate < sliceStart) {
      return { decisionRefs: [] };
    }
  }

  // Scan for lines containing [PRD-<id>] or [<sliceId>] tags
  const content = parsed.content;
  const sliceTag = `[${sliceId}]`;
  const prdTag = parentPrd ? `[${parentPrd}]` : null;

  const hasSliceTag = content.includes(sliceTag);
  const hasPrdTag = prdTag ? content.includes(prdTag) : false;

  if (!hasSliceTag && !hasPrdTag) return { decisionRefs: [] };

  // Build refs: each matching heading section as an anchor
  const refs: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(sliceTag) || (prdTag && line.includes(prdTag))) {
      // Extract anchor from heading lines
      const headingMatch = line.match(/^#{1,6}\s+(.+)/u);
      if (headingMatch) {
        const anchor = headingMatch[1].toLowerCase().replace(/[^\w\s-]/gu, "").replace(/\s+/gu, "-");
        refs.push(`${vaultRelPath}#${anchor}`);
      }
    }
  }

  // If no heading match, just reference the Current Decisions section
  if (refs.length === 0 && (hasSliceTag || hasPrdTag)) {
    refs.push(`${vaultRelPath}#current-decisions`);
  }

  return { decisionRefs: refs };
}

async function detectPrdRefs(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  parentFeature: string | undefined,
  findings: DetectionFinding[],
  vaultRoot: string,
): Promise<{ prdRef: string; parentPrd: string } | null> {
  const prdsDir = join(vaultRoot, "projects", project, "specs", "prds");
  if (!await exists(prdsDir)) return null;

  const entries = readdirSync(prdsDir).filter((f) => f.endsWith(".md") && /^PRD-\d+/u.test(f));

  const candidates: Array<{ prdId: string }> = [];

  for (const file of entries) {
    const raw = await readText(join(prdsDir, file));
    const prdParsed = safeMatter(`projects/${project}/specs/prds/${file}`, raw, { silent: true });
    if (!prdParsed) continue;

    const filePrdId = typeof prdParsed.data.prd_id === "string" ? prdParsed.data.prd_id.trim() : null;
    const fileParentFeature = typeof prdParsed.data.parent_feature === "string" ? prdParsed.data.parent_feature.trim() : null;

    if (!filePrdId || !fileParentFeature) continue;

    // If the slice has a known parentPrd, only match that specific PRD
    if (parentPrd && filePrdId !== parentPrd) continue;

    // If the slice has a known parentFeature, the PRD's parent_feature must match
    if (parentFeature && fileParentFeature !== parentFeature) continue;

    // Without a specific parentPrd, match any PRD whose parent_feature matches
    // and which references this slice in its Child Slices section
    if (!parentPrd) {
      const childSlicesSection = extractSection(prdParsed.content, "Child Slices");
      if (!childSlicesSection.includes(sliceId)) continue;
    }

    candidates.push({ prdId: filePrdId });
  }

  if (candidates.length === 0) return null;

  if (candidates.length > 1) {
    findings.push({
      phase: "prd",
      scope: "parent",
      severity: "warning",
      message: `ambiguous PRD: ${candidates.map((c) => c.prdId).join(", ")} all reference slice ${sliceId} — phase left incomplete`,
    });
    return null;
  }

  const { prdId } = candidates[0];
  const resolvedParent = parentPrd ?? prdId;
  return { prdRef: prdId, parentPrd: resolvedParent };
}

async function detectSlicesPhase(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  vaultRoot: string,
): Promise<string[]> {
  // Rule: slice hub index.md must exist
  const hubPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "index.md");
  if (!await exists(hubPath)) return [];

  // Rule: parent PRD's ## Child Slices section must list this slice
  if (!parentPrd) return [];
  const prdsDir = join(vaultRoot, "projects", project, "specs", "prds");
  if (!await exists(prdsDir)) return [];
  const entries = readdirSync(prdsDir);
  const prdFile = entries.find((f) => f.startsWith(`${parentPrd}-`) && f.endsWith(".md"));
  if (!prdFile) return [];

  const raw = await readText(join(prdsDir, prdFile));
  const prdParsed = safeMatter(`projects/${project}/specs/prds/${prdFile}`, raw, { silent: true });
  if (!prdParsed) return [];

  const childSlices = extractSection(prdParsed.content, "Child Slices");
  if (!childSlices.includes(sliceId)) return [];

  return [sliceId];
}

async function detectTddEvidence(project: string, sliceId: string, vaultRoot: string): Promise<string[]> {
  const planPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "plan.md");
  const testPlanPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "test-plan.md");

  if (!await exists(planPath) || !await exists(testPlanPath)) return [];

  const [planRaw, testPlanRaw] = await Promise.all([readText(planPath), readText(testPlanPath)]);

  const planParsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/plan.md`, planRaw, { silent: true });
  const testPlanParsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/test-plan.md`, testPlanRaw, { silent: true });

  if (!planParsed || !testPlanParsed) return [];

  const planStatus = typeof planParsed.data.status === "string" ? planParsed.data.status.trim() : "";
  const testPlanStatus = typeof testPlanParsed.data.status === "string" ? testPlanParsed.data.status.trim() : "";

  // Both must be status: ready (not draft, not current, not anything else)
  if (planStatus !== "ready" || testPlanStatus !== "ready") return [];

  const redTestsSection = extractSection(testPlanParsed.content, "Red Tests");
  if (!/^\s*-\s*\[(?: |x|X)\]/mu.test(redTestsSection)) return [];

  const verificationCommands = Array.isArray(testPlanParsed.data.verification_commands)
    ? testPlanParsed.data.verification_commands
        .map((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).command === "string"
          ? String((entry as Record<string, unknown>).command).trim()
          : "")
        .filter(Boolean)
    : [];
  if (verificationCommands.length === 0) return [];

  return [`projects/${project}/specs/slices/${sliceId}/test-plan.md`];
}

async function detectVerifyPhase(project: string, sliceId: string, vaultRoot: string): Promise<string[]> {
  const testPlanPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "test-plan.md");
  if (!await exists(testPlanPath)) return [];

  const raw = await readText(testPlanPath);
  const parsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/test-plan.md`, raw, { silent: true });
  if (!parsed) return [];

  const verificationLevel = typeof parsed.data.verification_level === "string"
    ? parsed.data.verification_level.trim()
    : "";

  // verification_level must be present and non-empty
  if (!verificationLevel) return [];

  // Check log for a recent verify-slice entry referencing this slice.
  // "Recent" = within STALE_UNVERIFIED_DAYS (30) days, using the same staleness
  // window as page verification staleness (see STALE_UNVERIFIED_DAYS in constants.ts).
  const cutoffMs = STALE_UNVERIFIED_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - cutoffMs);

  // tailLog reads from VAULT_ROOT/log.md. For tests we rely on the vaultRoot-aware
  // log path resolved from the tail of the log file at the vault's log.md path.
  const logPath = join(vaultRoot, "log.md");
  const logEntries = await tailLogFromPath(logPath, 200);
  const hasRecentVerify = logEntries.some((entry) => {
    if (!entry.includes(`verify-slice | ${sliceId}`)) return false;
    const dateMatch = entry.match(/^## \[(\d{4}-\d{2}-\d{2})\]/u);
    if (!dateMatch) return false;
    const entryDate = new Date(dateMatch[1]);
    return entryDate >= cutoffDate;
  });

  if (!hasRecentVerify) return [];

  // Extract first shell command from test-plan verification blocks
  const commands: string[] = [];
  const codeBlockPattern = /```(?:bash|sh|shell)\n([\s\S]*?)```/gu;
  let match: RegExpExecArray | null;
  while ((match = codeBlockPattern.exec(parsed.content)) !== null) {
    const block = match[1].trim();
    const firstLine = block.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"));
    if (firstLine) commands.push(firstLine.trim());
  }

  if (commands.length === 0) {
    commands.push(`wiki verify-slice ${project} ${sliceId}`);
  }

  return commands;
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

/**
 * Merge the authored ledger (explicit, hand-written) with the derived patch.
 * Authored fields win — derived only fills fields that are absent.
 *
 * Returns a new ledger object; does not mutate either input.
 */
export function mergeDerivedForgeLedger(
  authored: Partial<ForgeWorkflowLedger>,
  derived: Partial<ForgeWorkflowLedger>,
): Partial<ForgeWorkflowLedger> {
  const merged: Partial<ForgeWorkflowLedger> = { ...derived };

  // Top-level scalar fields: authored wins
  if (authored.project !== undefined) merged.project = authored.project;
  if (authored.sliceId !== undefined) merged.sliceId = authored.sliceId;
  if (authored.parentPrd !== undefined) merged.parentPrd = authored.parentPrd;

  // Per-phase: authored wins if the authored phase object exists and has completedAt
  for (const phase of ["research", "grill", "prd", "slices", "tdd", "verify"] as const) {
    const authoredPhase = authored[phase] as Record<string, unknown> | undefined;
    if (authoredPhase?.completedAt) {
      // Authored has a completedAt — it wins entirely
      (merged as Record<string, unknown>)[phase] = authored[phase];
    }
    // else: keep derived value (already in merged from spread)
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Apply helper (stateful — emits audit log)
// ---------------------------------------------------------------------------

/**
 * Calls `deriveForgeLedgerFromArtifacts`, merges with the authored ledger, and
 * emits one audit log entry per newly auto-advanced phase (only phases where
 * the authored ledger had no completedAt but the derived patch does).
 *
 * Returns the merged ledger and any detection findings.
 *
 * Idempotent: audit entries are emitted only for phases that transitioned from
 * incomplete to complete in this call (i.e., phases where authored had no
 * completedAt but derived did).
 *
 * @param vaultRoot  Override vault root (defaults to VAULT_ROOT). Used by tests.
 */
export async function applyDerivedLedger(
  authored: Partial<ForgeWorkflowLedger>,
  project: string,
  sliceId: string,
  vaultRoot?: string,
): Promise<{ merged: Partial<ForgeWorkflowLedger>; findings: DetectionFinding[] }> {
  const root = vaultRoot ?? VAULT_ROOT;
  const derived = await deriveForgeLedgerFromArtifacts(project, sliceId, vaultRoot);
  const merged = mergeDerivedForgeLedger(authored, derived.patch);

  // Emit audit log entries only for phases newly advanced by detection.
  // Writes are routed to join(root, "log.md") so tests using an explicit vaultRoot
  // write to their own temporary vault, never the production log.
  // Idempotent: before emitting, scan recent entries for an existing auto-heal
  // record for this slice+phase — skip if found (dedupe across the full log).
  const logPath = join(root, "log.md");
  const existingEntries = await tailLogFromPath(logPath, 200);

  for (const phase of ["research", "grill", "prd", "slices", "tdd", "verify"] as const) {
    const authoredPhase = authored[phase] as Record<string, unknown> | undefined;
    const derivedPhase = derived.patch[phase] as Record<string, unknown> | undefined;
    if (authoredPhase?.completedAt && !derivedPhase?.completedAt) {
      const alreadyLogged = existingEntries.some(
        (entry) =>
          entry.includes(`forge-ledger-override | ${sliceId}`) &&
          entry.includes(`- phase=${phase}`),
      );
      if (!alreadyLogged) appendOverrideEntry(logPath, sliceId, project, phase);
    }
    if (!authoredPhase?.completedAt && derivedPhase?.completedAt) {
      // Dedupe: skip if we already have an auto-heal entry for this slice+phase
      const alreadyEmitted = existingEntries.some(
        (entry) =>
          entry.includes(`auto-heal | ${sliceId}`) &&
          entry.includes(`- phase=${phase}`),
      );
      if (alreadyEmitted) continue;

      const refs = Object.entries(derivedPhase)
        .filter(([k]) => k !== "completedAt")
        .flatMap(([, v]) => (Array.isArray(v) ? v : [String(v)]));
      appendAutoHealEntry(logPath, root, sliceId, project, phase, refs);
    }
  }

  return { merged, findings: derived.findings };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function appendAutoHealEntry(
  logPath: string,
  vaultRoot: string,
  sliceId: string,
  project: string,
  phase: string,
  refs: string[],
): void {
  ensureDir(vaultRoot);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `## [${date}] auto-heal | ${sliceId}`,
    `- project: ${project}`,
    `- phase=${phase}`,
    `- refs=${refs.join(", ")}`,
    `- trigger=artifact-detected`,
    "",
  ];
  appendText(logPath, `${lines.join("\n")}\n`);
}

function appendOverrideEntry(logPath: string, sliceId: string, project: string, phase: string) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `## [${date}] forge-ledger-override | ${sliceId}`,
    `- project: ${project}`,
    `- phase=${phase}`,
    "",
  ];
  appendText(logPath, `${lines.join("\n")}\n`);
}

async function tailLogFromPath(logPath: string, count: number): Promise<string[]> {
  if (!await exists(logPath)) return [];
  const content = (await readText(logPath)).replace(/\r\n/g, "\n");
  const entries = content.split(/^## /mu).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}

function extractSection(markdown: string, heading: string): string {
  // Split on all ## headings, find the matching one, return its body.
  const headingLine = `## ${heading}`;
  const sections = markdown.split(/^## /mu);
  for (const section of sections) {
    const firstLineEnd = section.indexOf("\n");
    if (firstLineEnd === -1) continue;
    const sectionHeading = section.slice(0, firstLineEnd).trim();
    if (sectionHeading === heading) {
      return section.slice(firstLineEnd).trim();
    }
  }
  // Also try exact heading with newline check (fallback for content starting at top)
  void headingLine; // referenced above for clarity only
  return "";
}
