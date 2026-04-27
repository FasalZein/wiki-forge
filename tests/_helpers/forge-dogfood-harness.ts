import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { runWiki, setupPassingRepo, setRepoFrontmatter } from "../test-helpers";
import type { WikiRunResult } from "./wiki-subprocess";

type WikiEnv = Record<string, string>;

type DogfoodHarnessOptions = {
  project?: string;
  featureName?: string;
};

export type DogfoodHarness = {
  vault: string;
  repo: string;
  project: string;
  sliceId: string;
  env: WikiEnv;
  paths: {
    sliceDir: string;
    index: string;
    plan: string;
    testPlan: string;
  };
  runForgeNext(): WikiRunResult;
  runForgeStatus(sliceId?: string): WikiRunResult;
  runCheckpoint(extraArgs?: string[]): WikiRunResult;
  recordTddEvidence(): WikiRunResult;
  recordVerifyEvidence(): WikiRunResult;
  recordReview(): WikiRunResult;
  runForge(sliceId?: string): WikiRunResult;
};

const DEFAULT_PROJECT = "dogfood";
const DEFAULT_FEATURE = "forge dogfood lifecycle";

export function setupForgeDogfoodHarness(options: DogfoodHarnessOptions = {}): DogfoodHarness {
  const { vault, repo } = setupPassingRepo();
  const project = options.project ?? DEFAULT_PROJECT;
  const env = { KNOWLEDGE_VAULT_ROOT: vault };
  expect(runWiki(["scaffold-project", project], env).exitCode).toBe(0);
  setRepoFrontmatter(vault, repo, project);

  const plan = runWiki(["forge", "plan", project, options.featureName ?? DEFAULT_FEATURE, "--repo", repo, "--agent", "codex"], env);
  expect(plan.exitCode).toBe(0);
  const sliceId = readCreatedSliceId(plan.stdout.toString());
  const paths = slicePaths(vault, project, sliceId);
  writeReadySliceDocs(project, sliceId, paths);
  patchHubForDogfood(paths.index);

  expect(runWiki(["bind", project, `specs/slices/${sliceId}/index.md`, "src/payments.ts"], env).exitCode).toBe(0);
  for (const phase of ["research", "domain-model"] as const) {
    expect(runWiki(["forge", "skip", project, sliceId, phase, "--reason", "dogfood harness uses local fixture evidence"], env).exitCode).toBe(0);
  }

  return {
    vault,
    repo,
    project,
    sliceId,
    env,
    paths,
    runForgeNext: () => runWiki(["forge", "next", project, "--repo", repo, "--json"], env),
    runForgeStatus: (targetSliceId = sliceId) => runWiki(["forge", "status", project, targetSliceId, "--repo", repo, "--json"], env),
    runCheckpoint: (extraArgs = []) => runWiki(["checkpoint", project, "--repo", repo, "--base", "HEAD", "--json", ...extraArgs], env),
    recordTddEvidence: () => runWiki(["forge", "evidence", project, sliceId, "tdd", "--red", "dogfood fixture starts red", "--green", "bun test tests/payments.test.ts", "--json"], env),
    recordVerifyEvidence: () => runWiki(["forge", "evidence", project, sliceId, "verify", "--command", "bun test tests/payments.test.ts", "--json"], env),
    recordReview: () => runWiki(["forge", "review", "record", project, sliceId, "--verdict", "approved", "--reviewer", "dogfood-harness", "--repo", repo, "--json"], env),
    runForge: (targetSliceId = sliceId) => runWiki(["forge", "run", project, targetSliceId, "--repo", repo, "--json"], env),
  };
}

export function createStaleActiveSlice(harness: DogfoodHarness): { staleSliceId: string } {
  const stale = runWiki(["create-issue-slice", harness.project, "stale unrelated slice", "--source", "src/stale.ts", "--json"], harness.env);
  expect(stale.exitCode).toBe(0);
  const staleSliceId = stale.json<{ taskId: string }>().taskId;
  const paths = slicePaths(harness.vault, harness.project, staleSliceId);
  writeReadySliceDocs(harness.project, staleSliceId, paths, "src/stale.ts");
  const started = runWiki(["forge", "start", harness.project, staleSliceId, "--repo", harness.repo, "--agent", "codex", "--json"], harness.env);
  expect(started.exitCode).toBe(0);
  writeFileSync(paths.index, readFileSync(paths.index, "utf8").replace("status: in-progress", "status: in-progress\nlast_forge_run: '2026-04-01T00:00:00.000Z'\nlast_forge_step: checkpoint\nlast_forge_state: failed\nlast_forge_ok: false\nnext_action: wiki checkpoint"), "utf8");
  return { staleSliceId };
}

function readCreatedSliceId(output: string) {
  const match = output.match(/created slice ([A-Z0-9-]+)/u);
  if (!match?.[1]) throw new Error(`forge plan output did not include a created slice id:\n${output}`);
  return match[1];
}

function slicePaths(vault: string, project: string, sliceId: string) {
  const sliceDir = join(vault, "projects", project, "specs", "slices", sliceId);
  return {
    sliceDir,
    index: join(sliceDir, "index.md"),
    plan: join(sliceDir, "plan.md"),
    testPlan: join(sliceDir, "test-plan.md"),
  };
}

function writeReadySliceDocs(project: string, sliceId: string, paths: DogfoodHarness["paths"], sourcePath = "src/payments.ts") {
  const updatedAt = new Date().toISOString();
  writeFileSync(paths.plan, [
    "---",
    `title: ${sliceId} plan`,
    "type: spec",
    "spec_kind: plan",
    `project: ${project}`,
    "source_paths:",
    `  - ${sourcePath}`,
    `task_id: ${sliceId}`,
    "status: ready",
    `updated: ${updatedAt}`,
    "---",
    "",
    `# ${sliceId} plan`,
    "",
    "## Scope",
    "",
    "- Exercise the Forge dogfood lifecycle against a real CLI-backed slice.",
    "",
    "## Acceptance Criteria",
    "",
    "- Forge status, next, checkpoint, evidence, review, run, and close agree on the same slice.",
    "",
  ].join("\n"), "utf8");

  writeFileSync(paths.testPlan, [
    "---",
    `title: ${sliceId} test plan`,
    "type: spec",
    "spec_kind: test-plan",
    `project: ${project}`,
    "source_paths:",
    `  - ${sourcePath}`,
    `task_id: ${sliceId}`,
    "status: ready",
    `updated: ${updatedAt}`,
    "---",
    "",
    `# ${sliceId} test plan`,
    "",
    "## Verification Commands",
    "",
    "```bash",
    "bun test tests/payments.test.ts",
    "```",
    "",
  ].join("\n"), "utf8");
}

function patchHubForDogfood(indexPath: string) {
  const raw = readFileSync(indexPath, "utf8");
  if (raw.includes("review_policy:")) return;
  writeFileSync(indexPath, raw.replace("status: in-progress", "status: in-progress\nreview_policy:\n  required_approvals: 1"), "utf8");
}
