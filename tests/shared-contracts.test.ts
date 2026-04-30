import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("shared contracts", () => {
  test("command and frontmatter contracts are canonical shared contracts", () => {
    const sharedCommand = readRepoFile("src/shared/contracts/command.ts");
    const sharedFrontmatter = readRepoFile("src/shared/contracts/frontmatter.ts");
    const rootTypes = readRepoFile("src/types.ts");

    expect(sharedCommand).toContain("export type CommandHandler");
    expect(sharedFrontmatter).toContain("export type FrontmatterData");
    expect(rootTypes).not.toContain("export type CommandHandler =");
    expect(rootTypes).not.toContain("export type FrontmatterData =");
  });

  test("state contract is canonical shared contract", () => {
    const sharedStateContract = readRepoFile("src/shared/contracts/state-contract.ts");
    const libStateContract = readRepoFile("src/lib/wiki-contracts/state-contract.ts");

    expect(sharedStateContract).toContain("export function resolveStateContract");
    expect(sharedStateContract).toContain("export const RECONCILER_WRITE_SCOPE_CONTRACTS");
    expect(libStateContract).not.toContain("export function resolveStateContract");
    expect(libStateContract).toContain("../../shared/contracts/state-contract");
  });

  test("verification levels are canonical shared contracts", () => {
    const sharedVerificationLevels = readRepoFile("src/shared/verification/levels.ts");
    const rootConstants = readRepoFile("src/constants.ts");

    expect(sharedVerificationLevels).toContain("export const VERIFICATION_LEVELS");
    expect(sharedVerificationLevels).toContain("export type VerificationLevel");
    expect(sharedVerificationLevels).toContain("export const TEST_VERIFIED_LEVEL");
    expect(rootConstants).not.toContain("export const VERIFICATION_LEVELS =");
    expect(rootConstants).toContain("./shared/verification/levels");
  });

  test("project task read models are canonical shared contracts", () => {
    const sharedProjectTaskReadModel = readRepoFile("src/shared/contracts/project-task-read-model.ts");
    const wikiBacklogCollector = readRepoFile("src/wiki/project-views/backlog/collect.ts");
    const forgeSteeringTriage = readRepoFile("src/forge/steering/triage.ts");

    expect(sharedProjectTaskReadModel).toContain("export type ProjectTaskContext");
    expect(sharedProjectTaskReadModel).toContain("export type ProjectBacklogFocus");
    expect(wikiBacklogCollector).toContain("ProjectTaskContext");
    expect(forgeSteeringTriage).toContain("../../shared/contracts/project-task-read-model");
  });
});

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}
