import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { nowIso, orderFrontmatter, safeMatter, writeNormalizedPage } from "../cli-shared";
import { exists, readText } from "../lib/fs";
import { classifyResearchPath, normalizeInfluencedBy, normalizeResearchPageRef, normalizeWikiTarget } from "../lib/research";
import { printJson, printLine } from "../lib/cli-output";

export async function handoffResearch(args: string[]) {
  const { pageRef, targetRef, json } = parseHandoffArgs(args);
  const notePath = join(VAULT_ROOT, `${pageRef}.md`);
  if (!await exists(notePath)) throw new Error(`research page not found: ${pageRef}`);
  if (classifyResearchPath(`${pageRef}.md`) !== "research-page") throw new Error(`not a research page: ${pageRef}`);

  const raw = await readText(notePath);
  const parsed = safeMatter(`${pageRef}.md`, raw);
  if (!parsed) throw new Error(`could not parse research page: ${pageRef}`);

  const project = typeof parsed.data.project === "string" ? parsed.data.project.trim() : null;
  if (project && !targetRef.startsWith(`projects/${project}/`)) {
    throw new Error(`handoff target must stay inside projects/${project}/ for project-bound research`);
  }
  if (!isValidHandoffTarget(targetRef)) throw new Error(`invalid handoff target: ${targetRef}`);

  const influencedBy = normalizeInfluencedBy(parsed.data.influenced_by);
  const hadTarget = influencedBy.includes(targetRef);
  const nextInfluencedBy = hadTarget ? influencedBy : [...influencedBy, targetRef];
  const verification = typeof parsed.data.verification_level === "string" ? parsed.data.verification_level : "unverified";
  const applied = verification !== "unverified";
  const nextStatus = applied ? "applied" : (typeof parsed.data.status === "string" ? parsed.data.status : "draft");
  const data = orderFrontmatter({
    ...parsed.data,
    status: nextStatus,
    influenced_by: nextInfluencedBy,
    updated: nowIso(),
  }, ["title", "type", "topic", "project", "status", "source_type", "sources", "influenced_by", "created_at", "updated", "verification_level"]);
  writeNormalizedPage(notePath, parsed.content.trim(), data);

  const result = {
    page: pageRef,
    target: targetRef,
    applied,
    status: nextStatus,
    updatedInfluence: !hadTarget,
    nextAction: `append the accepted conclusion to ${targetRef}${applied ? "" : " after verification is complete"}`,
  };
  if (json) {
    printJson(result);
    return;
  }
  printLine(`research handoff: ${pageRef} -> ${targetRef}`);
  printLine(`- status: ${nextStatus}`);
  printLine(`- target recorded: ${hadTarget ? "already present" : "added to influenced_by"}`);
  printLine(`- next: ${result.nextAction}`);
}

export const distillResearch = handoffResearch;

function parseHandoffArgs(args: string[]) {
  const positionals = args.filter((arg) => !arg.startsWith("--"));
  const page = positionals[0];
  const target = positionals[1];
  if (!page) throw new Error("missing research page");
  if (!target) throw new Error("missing handoff target");
  const pageRef = normalizeResearchPageRef(page);
  if (!pageRef) throw new Error("missing research page");
  const targetRef = normalizeWikiTarget(target);
  if (!targetRef) throw new Error("missing handoff target");
  return { pageRef, targetRef, json: args.includes("--json") };
}

function isValidHandoffTarget(targetRef: string) {
  return /^projects\/[^/]+\/(?:decisions|architecture\/domain-language)$/u.test(targetRef);
}
