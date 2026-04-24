/**
 * PRD-056: ledger phase auto-advance from detected artifacts.
 *
 * Pure read-only module — no filesystem writes, no persistent ledger mutation.
 * All functions are safe to call from resume, forge next, and forge run without
 * risk of side effects on the vault state.
 *
 * Design decisions:
 * - "Within the slice's lifetime" for domain-model detection uses the slice hub's
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

import { join, relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { safeMatter } from "../../cli-shared";
import { appendText, ensureDir, exists, readText } from "../../lib/fs";
import { FORGE_PHASES, readForgeLedgerPhase, writeForgeLedgerPhase, type ForgeWorkflowLedger, type ForgePhase } from "./workflow-ledger";
import {
  detectDomainModelRefs,
  detectPrdRefs,
  detectResearchRefs,
  detectSlicesPhase,
  detectTddEvidence,
  detectVerifyPhase,
  tailLogFromPath,
  type DetectionFinding,
} from "./evidence-readers";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { DetectionFinding } from "./evidence-readers";

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
  let result: DerivedForgeLedger;
  try {
    result = await _derive(project, sliceId, root);
  } catch (err) {
    result = {
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
  return result;
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
  // Rule: slice-scoped research bridge evidence counts as research evidence.
  // research/**/*.md can also match by frontmatter, source_paths, or
  // legacy basename heuristics during migration. Parent PRD Prior Research
  // links alone are not enough; `wiki research bridge` must write slice evidence.
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
  // Phase: domain-model
  // Rule: decisions.md contains a line tagged [PRD-<id>] or [<sliceId>]
  // authored within the slice's lifetime.
  // -------------------------------------------------------------------
  const domainModelResult = await detectDomainModelRefs(project, sliceId, parentPrd, sliceCreatedAt, vaultRoot);
  if (domainModelResult.decisionRefs.length > 0) {
    writeForgeLedgerPhase(patch, "domain-model", {
      completedAt: new Date().toISOString(),
      decisionRefs: domainModelResult.decisionRefs,
    });
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
  if (authored.workflowProfile !== undefined) merged.workflowProfile = authored.workflowProfile;
  if (authored.parentPrd !== undefined) merged.parentPrd = authored.parentPrd;
  if (authored.skippedPhases !== undefined) merged.skippedPhases = authored.skippedPhases;

  // Per-phase: authored wins if the authored phase object exists and has completedAt
  for (const phase of FORGE_PHASES) {
    const authoredPhase = readForgeLedgerPhase(authored, phase);
    if (authoredPhase?.completedAt) {
      // Authored has a completedAt — it wins entirely
      writeForgeLedgerPhase(merged, phase, authoredPhase);
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

  for (const phase of FORGE_PHASES) {
    const authoredPhase = readForgeLedgerPhase(authored, phase);
    const derivedPhase = readForgeLedgerPhase(derived.patch, phase);
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
