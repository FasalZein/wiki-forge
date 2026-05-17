import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { STALE_UNVERIFIED_DAYS } from "../../constants";
import { safeMatter } from "../../cli-shared";
import { extractMarkdownSection, readPlanningDoc } from "./evidence";
import { exists, readText } from "../../lib/fs";
import type { ForgePhase } from "./workflow-ledger";
import { normalizePath, stripMarkdownExtension, walkMarkdown } from "../../lib/vault";
import { extractVerificationSpecsFromTestPlan } from "../../shared/verification/specs";

export type DetectionFinding = {
  phase: ForgePhase;
  scope: "slice" | "parent";
  severity: "warning" | "info";
  message: string;
};

export async function detectResearchRefs(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  vaultRoot: string,
): Promise<{ refs: string[] }> {
  const projectResearchDir = join(vaultRoot, "projects", project, "research");

  const prdSourcePaths = new Set<string>();
  const prdsDir = join(vaultRoot, "projects", project, "specs", "prds");
  const prdDoc = parentPrd ? await readPlanningDoc(prdsDir, parentPrd, vaultRoot) : null;
  if (prdDoc && Array.isArray(prdDoc.data.source_paths)) {
    for (const sp of prdDoc.data.source_paths) {
      if (typeof sp === "string") prdSourcePaths.add(sp.trim());
    }
  }

  const refs: string[] = [];
  const candidateFiles = new Set<string>();

  if (await exists(projectResearchDir)) {
    for (const file of await walkMarkdown(projectResearchDir)) candidateFiles.add(file);
  }

  for (const sourcePath of prdSourcePaths) {
    const normalized = normalizePath(sourcePath).replace(/\.md$/u, "");
    if (normalized.startsWith("research/projects/")) continue;
    const absolute = join(vaultRoot, `${normalized}.md`);
    if (await exists(absolute)) candidateFiles.add(absolute);
  }

  for (const file of candidateFiles) {
    const relVaultPath = normalizePath(relative(vaultRoot, file));
    const relNoExt = stripMarkdownExtension(relVaultPath);
    const matchesBySourcePath = prdSourcePaths.has(relVaultPath) || prdSourcePaths.has(relNoExt);
    const parsed = safeMatter(relVaultPath, await readText(file), { silent: true });
    const taskId = typeof parsed?.data.task_id === "string" ? parsed.data.task_id.trim() : "";
    const sliceFrontmatterId = typeof parsed?.data.slice_id === "string" ? parsed.data.slice_id.trim() : "";
    const matchesByFrontmatter = taskId === sliceId || sliceFrontmatterId === sliceId;

    if (matchesByFrontmatter || matchesBySourcePath) refs.push(relNoExt);
  }

  return { refs: [...new Set(refs)] };
}

export async function detectGrillWithDocsRefs(
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

  const decisionsUpdated = typeof parsed.data.updated === "string" ? parsed.data.updated.trim() : null;
  if (sliceCreatedAt && decisionsUpdated) {
    const sliceStart = new Date(sliceCreatedAt).getTime();
    const decisionsUpdate = new Date(decisionsUpdated).getTime();
    if (decisionsUpdate < sliceStart) {
      return { decisionRefs: [] };
    }
  }

  const content = parsed.content;
  const sliceTag = `[${sliceId}]`;
  const prdTag = parentPrd ? `[${parentPrd}]` : null;

  const hasSliceTag = content.includes(sliceTag);
  const hasPrdTag = prdTag ? content.includes(prdTag) : false;

  if (!hasSliceTag && !hasPrdTag) return { decisionRefs: [] };

  const refs: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(sliceTag) || (prdTag && line.includes(prdTag))) {
      const wikiLinkMatch = line.match(/\[\[(projects\/[^|\]]+)(?:\|[^\]]+)?\]\]/u);
      if (wikiLinkMatch?.[1]) {
        refs.push(wikiLinkMatch[1].endsWith(".md") ? wikiLinkMatch[1] : `${wikiLinkMatch[1]}.md`);
        continue;
      }
      const headingMatch = line.match(/^#{1,6}\s+(.+)/u);
      if (headingMatch) {
        const anchor = headingMatch[1].toLowerCase().replace(/[^\w\s-]/gu, "").replace(/\s+/gu, "-");
        refs.push(`${vaultRelPath}#${anchor}`);
      }
    }
  }

  if (refs.length === 0 && (hasSliceTag || hasPrdTag)) {
    refs.push(`${vaultRelPath}#current-decisions`);
  }

  return { decisionRefs: refs };
}

export async function detectPrdRefs(
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
    if (parentPrd && filePrdId !== parentPrd) continue;
    if (parentFeature && fileParentFeature !== parentFeature) continue;

    if (!parentPrd) {
      const childSlicesSection = extractMarkdownSection(prdParsed.content, "Child Slices");
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
  return { prdRef: prdId, parentPrd: parentPrd ?? prdId };
}

export async function detectSlicesPhase(
  project: string,
  sliceId: string,
  parentPrd: string | undefined,
  vaultRoot: string,
): Promise<string[]> {
  const hubPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "index.md");
  if (!await exists(hubPath)) return [];
  if (!parentPrd) return [];

  const prdsDir = join(vaultRoot, "projects", project, "specs", "prds");
  if (!await exists(prdsDir)) return [];
  const entries = readdirSync(prdsDir);
  const prdFile = entries.find((f) => f.startsWith(`${parentPrd}-`) && f.endsWith(".md"));
  if (!prdFile) return [];

  const raw = await readText(join(prdsDir, prdFile));
  const prdParsed = safeMatter(`projects/${project}/specs/prds/${prdFile}`, raw, { silent: true });
  if (!prdParsed) return [];

  const childSlices = extractMarkdownSection(prdParsed.content, "Child Slices");
  return childSlices.includes(sliceId) ? [sliceId] : [];
}

export async function detectTddEvidence(project: string, sliceId: string, vaultRoot: string): Promise<string[]> {
  const planPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "plan.md");
  const testPlanPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "test-plan.md");

  if (!await exists(planPath) || !await exists(testPlanPath)) return [];

  const [planRaw, testPlanRaw] = await Promise.all([readText(planPath), readText(testPlanPath)]);
  const planParsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/plan.md`, planRaw, { silent: true });
  const testPlanParsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/test-plan.md`, testPlanRaw, { silent: true });
  if (!planParsed || !testPlanParsed) return [];

  const planStatus = typeof planParsed.data.status === "string" ? planParsed.data.status.trim() : "";
  const testPlanStatus = typeof testPlanParsed.data.status === "string" ? testPlanParsed.data.status.trim() : "";
  if (planStatus !== "ready" || testPlanStatus !== "ready") return [];

  const redTestsSection = extractMarkdownSection(testPlanParsed.content, "Red Tests");
  if (!/^\s*-\s*\[(?: |x|X)\]/mu.test(redTestsSection)) return [];

  const verificationCommands = extractVerificationSpecsFromTestPlan(testPlanParsed.content, testPlanParsed.data)
    .map((entry) => entry.command.trim())
    .filter(Boolean);
  if (verificationCommands.length === 0) return [];

  return [`projects/${project}/specs/slices/${sliceId}/test-plan.md`];
}

export async function detectVerifyPhase(project: string, sliceId: string, vaultRoot: string): Promise<string[]> {
  const testPlanPath = join(vaultRoot, "projects", project, "specs", "slices", sliceId, "test-plan.md");
  if (!await exists(testPlanPath)) return [];

  const raw = await readText(testPlanPath);
  const parsed = safeMatter(`projects/${project}/specs/slices/${sliceId}/test-plan.md`, raw, { silent: true });
  if (!parsed) return [];

  const verificationLevel = typeof parsed.data.verification_level === "string"
    ? parsed.data.verification_level.trim()
    : "";
  if (!verificationLevel) return [];

  const cutoffMs = STALE_UNVERIFIED_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - cutoffMs);
  const logPath = join(vaultRoot, "log.md");
  const logEntries = await tailLogFromPath(logPath, 200);
  const hasRecentVerify = logEntries.some((entry) => {
    if (!entry.includes(`forge-verify | ${sliceId}`)) return false;
    const dateMatch = entry.match(/^## \[(\d{4}-\d{2}-\d{2})\]/u);
    if (!dateMatch) return false;
    return new Date(dateMatch[1]) >= cutoffDate;
  });

  if (!hasRecentVerify) return [];

  const commands: string[] = [];
  const codeBlockPattern = /```(?:bash|sh|shell)\n([\s\S]*?)```/gu;
  let match: RegExpExecArray | null;
  while ((match = codeBlockPattern.exec(parsed.content)) !== null) {
    const block = match[1].trim();
    const firstLine = block.split("\n").find((line) => line.trim() && !line.trim().startsWith("#"));
    if (firstLine) commands.push(firstLine.trim());
  }

  if (commands.length === 0) {
    commands.push(`wiki forge evidence ${project} ${sliceId} verify --command <cmd>`);
  }

  return commands;
}

export async function tailLogFromPath(logPath: string, count: number): Promise<string[]> {
  if (!await exists(logPath)) return [];
  const content = (await readText(logPath)).replace(/\r\n/g, "\n");
  const entries = content.split(/^## /mu).filter(Boolean).map((chunk) => `## ${chunk.trimEnd()}`);
  return entries.slice(-count);
}
