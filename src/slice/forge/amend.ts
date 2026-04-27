import { relative } from "node:path";
import { VAULT_ROOT } from "../../constants";
import { nowIso, orderFrontmatter, requireValue, safeMatter, writeNormalizedPage } from "../../cli-shared";
import { readFlagValue } from "../../lib/cli-utils";
import { exists, readText } from "../../lib/fs";
import { appendLogEntry } from "../../lib/log";
import { projectTaskHubPath, projectTaskPlanPath, projectTaskTestPlanPath, toVaultWikilinkPath } from "../../lib/structure";
import { collectTaskContextForId } from "../../hierarchy";
import { hasCanonicalSliceCompletionEvidence, readSliceHub, readSliceSourcePaths } from "../docs";
import { createIssueSliceCore } from "../docs/scaffold";
import { startSliceCore } from "../lifecycle/start";
import { defaultAgentName } from "../shared";
import { printJson, printLine } from "../../lib/cli-output";

const AMENDMENT_FRONTMATTER_ORDER = [
  "title", "type", "spec_kind", "project", "source_paths", "assignee", "task_id",
  "depends_on", "amendment_of", "amendment_reason", "amendment_created_at",
  "parent_prd", "parent_feature", "claimed_by", "claimed_at", "claim_paths",
  "created_at", "updated", "started_at", "completed_at", "status", "verification_level",
  "review_policy",
];

type ForgeAmendArgs = {
  project: string;
  closedSliceId: string;
  reason: string;
  title: string | undefined;
  agent: string | undefined;
  repo: string | undefined;
  sourcePaths: string[];
  start: boolean;
  json: boolean;
};

export async function forgeAmend(args: string[]): Promise<void> {
  const parsed = parseForgeAmendArgs(args);
  const context = await collectTaskContextForId(parsed.project, parsed.closedSliceId);
  if (!context) throw new Error(`slice not found in backlog: ${parsed.closedSliceId}`);

  const closedHub = await readSliceHub(parsed.project, parsed.closedSliceId);
  const canonicalClosed = context.canonicalCompletion || hasCanonicalSliceCompletionEvidence(closedHub.data);
  if (!canonicalClosed) {
    throw new Error(`cannot amend ${parsed.closedSliceId}: slice is not canonically closed`);
  }

  const inheritedSourcePaths = parsed.sourcePaths.length
    ? parsed.sourcePaths
    : await readSliceSourcePaths(parsed.project, parsed.closedSliceId);
  const parentPrd = typeof closedHub.data.parent_prd === "string" ? closedHub.data.parent_prd : undefined;
  const title = parsed.title ?? `Amend ${parsed.closedSliceId}`;
  const createArgs = [
    parsed.project,
    title,
    ...(parentPrd ? ["--prd", parentPrd] : []),
    ...(parsed.agent ? ["--assignee", parsed.agent] : []),
    ...(inheritedSourcePaths.length ? ["--source", ...inheritedSourcePaths] : []),
  ];
  const created = await createIssueSliceCore(createArgs);
  const createdAt = nowIso();
  await patchAmendmentDocs(parsed.project, created.taskId, parsed.closedSliceId, parsed.reason, createdAt);

  let startedAt: string | undefined;
  if (parsed.start) {
    const agent = parsed.agent ?? defaultAgentName();
    const startResult = await startSliceCore(parsed.project, created.taskId, agent, parsed.repo);
    if (!startResult.ok) throw new Error(startResult.error ?? `could not start amendment slice ${created.taskId}`);
    startedAt = startResult.startedAt;
  }

  appendLogEntry("forge-amend", created.taskId, {
    project: parsed.project,
    details: [
      `amendment_of=${parsed.closedSliceId}`,
      `reason=${parsed.reason}`,
      ...(parsed.start ? ["started=true"] : []),
    ],
  });

  const result = {
    project: parsed.project,
    closedSliceId: parsed.closedSliceId,
    amendmentSliceId: created.taskId,
    reason: parsed.reason,
    sourcePaths: inheritedSourcePaths,
    started: parsed.start,
    ...(startedAt ? { startedAt } : {}),
    paths: {
      index: created.indexPath,
      plan: created.planPath,
      testPlan: created.testPlanPath,
    },
  };

  if (parsed.json) {
    printJson(result);
    return;
  }

  printLine(`created amendment slice ${created.taskId} for ${parsed.closedSliceId}`);
  printLine(`- reason: ${parsed.reason}`);
  printLine(`- index: ${created.indexPath}`);
  printLine(`- plan: ${created.planPath}`);
  printLine(`- test-plan: ${created.testPlanPath}`);
  if (parsed.start) printLine(`- started: ${created.taskId}`);
  else printLine(`- next: wiki forge start ${parsed.project} ${created.taskId}${parsed.repo ? ` --repo ${parsed.repo}` : ""}`);
}

function parseForgeAmendArgs(args: string[]): ForgeAmendArgs {
  const project = args[0];
  const closedSliceId = args[1];
  requireValue(project, "project");
  requireValue(closedSliceId, "closed-slice-id");
  const reason = readFlagValue(args, "--reason")?.trim();
  requireValue(reason, "--reason");
  const sourcePaths: string[] = [];
  let title: string | undefined;
  let agent: string | undefined;
  let repo: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--title":
        title = args[index + 1];
        index += 1;
        break;
      case "--agent":
        agent = args[index + 1];
        index += 1;
        break;
      case "--repo":
        repo = args[index + 1];
        index += 1;
        break;
      case "--source":
        while (args[index + 1] && !args[index + 1]?.startsWith("--")) {
          sourcePaths.push(String(args[index + 1]).replaceAll("\\", "/"));
          index += 1;
        }
        break;
      case "--reason":
        index += 1;
        break;
      case "--start":
      case "--json":
        break;
    }
  }
  return {
    project: project.trim(),
    closedSliceId: closedSliceId.trim().toUpperCase(),
    reason,
    title: title?.trim() || undefined,
    agent: agent?.trim() || undefined,
    repo: repo?.trim() || undefined,
    sourcePaths: [...new Set(sourcePaths.map((sourcePath) => sourcePath.trim()).filter(Boolean))],
    start: args.includes("--start"),
    json: args.includes("--json"),
  };
}

async function patchAmendmentDocs(project: string, amendmentSliceId: string, closedSliceId: string, reason: string, createdAt: string) {
  const closedSliceLink = toVaultWikilinkPath(projectTaskHubPath(project, closedSliceId));
  const docs = [
    { path: projectTaskHubPath(project, amendmentSliceId), section: buildIndexAmendmentSection(closedSliceId, closedSliceLink, reason), requiresReview: true },
    { path: projectTaskPlanPath(project, amendmentSliceId), section: buildPlanAmendmentSection(closedSliceId, closedSliceLink, reason), requiresReview: false },
    { path: projectTaskTestPlanPath(project, amendmentSliceId), section: buildTestPlanAmendmentSection(closedSliceId, closedSliceLink, reason), requiresReview: false },
  ];

  for (const doc of docs) {
    if (!await exists(doc.path)) throw new Error(`amendment doc missing: ${relative(VAULT_ROOT, doc.path)}`);
    const raw = await readText(doc.path);
    const parsed = safeMatter(relative(VAULT_ROOT, doc.path), raw);
    if (!parsed) throw new Error(`could not parse amendment doc: ${relative(VAULT_ROOT, doc.path)}`);
    const data = orderFrontmatter({
      ...parsed.data,
      depends_on: mergeDependsOn(parsed.data.depends_on, closedSliceId),
      amendment_of: closedSliceId,
      amendment_reason: reason,
      amendment_created_at: createdAt,
      ...(doc.requiresReview ? { review_policy: { required_approvals: 1 } } : {}),
      updated: createdAt,
    }, AMENDMENT_FRONTMATTER_ORDER);
    writeNormalizedPage(doc.path, insertAmendmentSection(parsed.content, doc.section), data);
  }
}

function mergeDependsOn(value: unknown, closedSliceId: string) {
  const dependencies = new Set<string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const dependency = String(entry).trim().toUpperCase();
      if (dependency) dependencies.add(dependency);
    }
  }
  dependencies.add(closedSliceId);
  return [...dependencies].sort();
}

function insertAmendmentSection(content: string, section: string) {
  if (content.includes("## Amendment")) return content;
  const normalized = content.replace(/^\n+/, "");
  if (!/\n## /u.test(normalized)) return `${normalized.trimEnd()}\n\n${section}`;
  return normalized.replace(/\n## /u, `\n${section}\n## `);
}

function buildIndexAmendmentSection(closedSliceId: string, closedSliceLink: string, reason: string) {
  return [
    "## Amendment",
    "",
    `- Amends closed slice: [[${closedSliceLink}|${closedSliceId}]]`,
    `- Reason: ${reason}`,
    "- Do not reopen or edit the closed slice; this amendment carries the follow-up work.",
    "",
  ].join("\n");
}

function buildPlanAmendmentSection(closedSliceId: string, closedSliceLink: string, reason: string) {
  return [
    "## Amendment Context",
    "",
    `- Closed slice: [[${closedSliceLink}|${closedSliceId}]]`,
    `- Reason: ${reason}`,
    "- Preserve the original close evidence; scope only the follow-up change here.",
    "",
  ].join("\n");
}

function buildTestPlanAmendmentSection(closedSliceId: string, closedSliceLink: string, reason: string) {
  return [
    "## Amendment Verification Context",
    "",
    `- Closed slice: [[${closedSliceLink}|${closedSliceId}]]`,
    `- Reason: ${reason}`,
    "- Add regression coverage that proves the amended behavior without mutating prior close evidence.",
    "",
  ].join("\n");
}
