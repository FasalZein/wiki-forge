import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const REMOVED_REPO_OWNED_SKILLS = ["research", "prototype", "setup-matt-pocock-skills", "triage", "zoom-out"];
const CURRENT_REPO_OWNED_SKILLS = [
  "diagnose",
  "forge",
  "grill-with-docs",
  "handoff",
  "improve-codebase-architecture",
  "prd-to-slices",
  "tdd",
  "wiki",
  "write-a-prd",
];

describe("external optional skill documentation", () => {
  test("README documents the minimized repo-owned skill set", () => {
    const readme = readFileSync("README.md", "utf8");
    const repoOwnedSection = sectionBetween(readme, "Current repo-owned skill set:", "External optional skills:");

    for (const skill of CURRENT_REPO_OWNED_SKILLS) expect(repoOwnedSection).toContain(`- \`${skill}\``);
    for (const skill of REMOVED_REPO_OWNED_SKILLS) expect(repoOwnedSection).not.toContain(`- \`${skill}\``);
  });

  test("README presents research, prototype, and desloppify as external optional skills", () => {
    const readme = readFileSync("README.md", "utf8");
    const externalSection = sectionBetween(readme, "External optional skills:", "Or install any individual skill from GitHub:");

    expect(externalSection).toContain("`research`");
    expect(externalSection).toContain("`prototype`");
    expect(externalSection).toContain("`desloppify`");
    expect(externalSection).toContain("not bundled into this repository");
  });

  test("SETUP explains sync no longer relinks the global CLI unless explicitly requested", () => {
    const setup = readFileSync("SETUP.md", "utf8");

    expect(setup).toContain("does not relink the global `wiki` CLI by default");
    expect(setup).toContain("bun run sync:link-cli");
    expect(setup).not.toContain("It relinks the CLI");
    expect(setup).not.toContain("the linked `wiki` CLI via `bun link`");
    expect(setup).not.toContain("CLI + QMD only");
  });

  test("docs do not describe external optional skills as bundled repo-owned skills", () => {
    const docs = [readFileSync("README.md", "utf8"), readFileSync("SETUP.md", "utf8")].join("\n");

    expect(docs).not.toContain("external `/desloppify` companion");
    expect(docs).not.toContain("repo-owned workflow skills plus the external `/desloppify` companion");
    expect(docs).not.toContain("/forge` expects these repo-owned workflow skills plus");
  });
});

function sectionBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}
