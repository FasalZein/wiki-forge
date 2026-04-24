import { join } from "node:path";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../cli-shared";
import { VAULT_ROOT } from "../constants";
import { readPlanningDoc, collectPriorResearchRefs, type MatterDoc } from "../protocol/status/index";
import { appendLogEntry } from "../lib/log";
import { exists, readText } from "../lib/fs";
import { normalizeInfluencedBy, normalizeResearchPageRef } from "../lib/research";
import { projectPrdsDir, projectTaskHubPath, toVaultWikilinkPath } from "../lib/structure";
import { printJson, printLine } from "../lib/cli-output";

const RESEARCH_FRONTMATTER_ORDER = [
  "title",
  "type",
  "topic",
  "project",
  "status",
  "source_type",
  "sources",
  "influenced_by",
  "created_at",
  "updated",
  "verification_level",
] as const;

const SLICE_HUB_FRONTMATTER_ORDER = [
  "title",
  "type",
  "spec_kind",
  "project",
  "source_paths",
  "assignee",
  "task_id",
  "depends_on",
  "parent_prd",
  "parent_feature",
  "claimed_by",
  "claimed_at",
  "claim_paths",
  "created_at",
  "updated",
  "started_at",
  "completed_at",
  "status",
  "verification_level",
  "workflow_profile",
  "forge_workflow_ledger",
] as const;

export async function bridgeResearch(args: string[]) {
  const { pageRef, project, sliceId, json } = parseBridgeArgs(args);
  const notePath = join(VAULT_ROOT, `${pageRef}.md`);
  if (!await exists(notePath)) throw new Error(`research page not found: ${pageRef}`);

  const rawNote = await readText(notePath);
  const parsedNote = safeMatter(`${pageRef}.md`, rawNote);
  if (!parsedNote) throw new Error(`could not parse research page: ${pageRef}`);

  const noteProject = typeof parsedNote.data.project === "string" ? parsedNote.data.project.trim() : "";
  if (noteProject && noteProject !== project) {
    throw new Error(`research page project mismatch: expected ${project}, found ${noteProject}`);
  }

  const sliceHubPath = projectTaskHubPath(project, sliceId);
  if (!await exists(sliceHubPath)) throw new Error(`slice hub not found: projects/${project}/specs/slices/${sliceId}/index.md`);
  const rawHub = await readText(sliceHubPath);
  const parsedHub = safeMatter(`projects/${project}/specs/slices/${sliceId}/index.md`, rawHub);
  if (!parsedHub) throw new Error(`could not parse slice hub for ${sliceId}`);

  const parentPrd = typeof parsedHub.data.parent_prd === "string" ? parsedHub.data.parent_prd.trim() : "";
  if (!parentPrd) throw new Error(`slice ${sliceId} has no parent_prd`);

  const prdDoc = await readPlanningDoc(projectPrdsDir(project), parentPrd);
  if (!prdDoc) throw new Error(`parent PRD not found for ${sliceId}: ${parentPrd}`);

  const researchLink = `[[${pageRef}]]`;
  const prdRef = toVaultWikilinkPath(prdDoc.path);
  const nextPrdContent = upsertPriorResearchLink(prdDoc.content, pageRef, researchLink);
  const prdChanged = nextPrdContent !== prdDoc.content;
  if (prdChanged) {
    writeNormalizedPage(prdDoc.path, nextPrdContent, orderFrontmatter({
      ...prdDoc.data,
      updated: nowIso(),
    }, Object.keys(prdDoc.data)));
  }

  const existingInfluence = normalizeInfluencedBy(parsedNote.data.influenced_by);
  const influencedBy = existingInfluence.includes(prdRef) ? existingInfluence : [...existingInfluence, prdRef];
  const noteChanged = influencedBy.length !== existingInfluence.length;
  if (noteChanged) {
    writeNormalizedPage(notePath, parsedNote.content.trim(), orderFrontmatter({
      ...parsedNote.data,
      influenced_by: influencedBy,
      updated: nowIso(),
    }, [...RESEARCH_FRONTMATTER_ORDER]));
  }

  const ledgerChanged = recordSliceResearchBridge({
    project,
    sliceId,
    pageRef,
    sliceHubPath,
    parsedHub,
  });

  const result = {
    page: pageRef,
    project,
    sliceId,
    prdRef,
    parentPrd,
    adopted: prdChanged || noteChanged || ledgerChanged,
    addedToPrd: prdChanged,
    updatedInfluence: noteChanged,
    recordedSliceEvidence: ledgerChanged,
    nextAction: `wiki forge status ${project} ${sliceId}`,
  };
  if (json) {
    printJson(result);
    return;
  }
  printLine(`research bridge: ${pageRef} -> ${sliceId}`);
  printLine(`- project: ${project}`);
  printLine(`- parent PRD: ${parentPrd}`);
  printLine(`- added to Prior Research: ${prdChanged ? "yes" : "already present"}`);
  printLine(`- recorded in influenced_by: ${noteChanged ? "yes" : "already present"}`);
  printLine(`- recorded in slice ledger: ${ledgerChanged ? "yes" : "already present"}`);
  printLine(`- next: ${result.nextAction}`);
}

export const adoptResearch = bridgeResearch;

function parseBridgeArgs(args: string[]) {
  let page: string | undefined;
  let project: string | undefined;
  let sliceId: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (!arg.startsWith("--") && !page) {
      page = arg;
      continue;
    }
    if (arg === "--project") {
      project = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--slice") {
      sliceId = args[i + 1];
      i += 1;
      continue;
    }
  }

  const pageRef = page ? normalizeResearchPageRef(page) : null;
  if (!pageRef) throw new Error("missing research page");
  if (!project?.trim()) throw new Error("missing --project <project>");
  if (!sliceId?.trim()) throw new Error("missing --slice <slice-id>");
  return { pageRef, project: project.trim(), sliceId: sliceId.trim(), json: args.includes("--json") };
}

function recordSliceResearchBridge(input: {
  project: string;
  sliceId: string;
  pageRef: string;
  sliceHubPath: string;
  parsedHub: NonNullable<ReturnType<typeof safeMatter>>;
}): boolean {
  const existingLedger = input.parsedHub.data.forge_workflow_ledger && typeof input.parsedHub.data.forge_workflow_ledger === "object"
    ? { ...(input.parsedHub.data.forge_workflow_ledger as Record<string, unknown>) }
    : {};
  const existingResearch = existingLedger.research && typeof existingLedger.research === "object"
    ? { ...(existingLedger.research as Record<string, unknown>) }
    : {};
  const existingRefs = Array.isArray(existingResearch.researchRefs)
    ? existingResearch.researchRefs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
    : [];
  const researchRefs = [...new Set([...existingRefs, input.pageRef])];
  const completedAt = typeof existingResearch.completedAt === "string" && existingResearch.completedAt.trim()
    ? existingResearch.completedAt
    : nowIso();
  const changed = researchRefs.length !== existingRefs.length || existingResearch.completedAt !== completedAt;
  if (!changed) return false;

  existingLedger.research = {
    ...existingResearch,
    completedAt,
    researchRefs,
  };
  const updated = nowIso();
  writeNormalizedPage(
    input.sliceHubPath,
    input.parsedHub.content,
    orderFrontmatter(
      {
        ...input.parsedHub.data,
        forge_workflow_ledger: existingLedger,
        updated,
      },
      [...SLICE_HUB_FRONTMATTER_ORDER],
    ),
  );
  appendLogEntry("research-bridge", input.sliceId, {
    project: input.project,
    details: [`page=${input.pageRef}`],
  });
  return true;
}

function upsertPriorResearchLink(markdown: string, pageRef: string, researchLink: string) {
  const pseudoDoc: MatterDoc = { path: "", data: {}, content: markdown };
  const existingRefs = new Set(collectPriorResearchRefs(pseudoDoc).map(stripAnchor));
  if (existingRefs.has(pageRef)) return markdown;

  const heading = "## Prior Research";
  const openQuestionsHeading = "\n## Open Questions";
  const sectionIndex = markdown.indexOf(heading);
  const placeholderLines = new Set([
    "- Add topic-first research links here, e.g. `[[research/auth/_overview]]`.",
    "- For project-bound research, use `wiki research file <topic> --project {{project}} <title>` before linking the note here.",
    "- For project-bound research, use `wiki research file <topic> --project wiki-forge <title>` before linking the note here.",
  ]);

  if (sectionIndex === -1) {
    const insertionPoint = markdown.indexOf(openQuestionsHeading);
    const block = `${heading}\n\n- ${researchLink}\n\n`;
    if (insertionPoint === -1) return `${markdown.trimEnd()}\n\n${block}`.trimEnd();
    return `${markdown.slice(0, insertionPoint).trimEnd()}\n\n${block}${markdown.slice(insertionPoint + 1)}`.trimEnd();
  }

  const sectionBodyStart = markdown.indexOf("\n", sectionIndex);
  if (sectionBodyStart === -1) return `${markdown.trimEnd()}\n\n${heading}\n\n- ${researchLink}\n`;
  const nextHeadingIndex = markdown.indexOf("\n## ", sectionBodyStart + 1);
  const before = markdown.slice(0, sectionBodyStart + 1);
  const after = nextHeadingIndex === -1 ? "" : markdown.slice(nextHeadingIndex + 1);
  const sectionBody = markdown.slice(sectionBodyStart + 1, nextHeadingIndex === -1 ? markdown.length : nextHeadingIndex).trim();
  const lines = sectionBody
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !placeholderLines.has(line.trim()));
  lines.push(`- ${researchLink}`);
  const nextBody = `${before}\n${lines.join("\n")}\n\n${after}`.trimEnd();
  return nextBody.endsWith("\n") ? nextBody : `${nextBody}\n`;
}

function stripAnchor(ref: string) {
  return ref.split("#")[0] ?? ref;
}
