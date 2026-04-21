import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/tothemoon/Dev/Code Forge/knowledge-wiki-system";
const AX_DIR = join(ROOT, "experiments", "ax-optimizer");

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("AX optimizer scaffold", () => {
  test("sidecar package declares AX and both optimization tracks", () => {
    const pkg = JSON.parse(read(join(AX_DIR, "package.json")));
    expect(pkg.dependencies["@ax-llm/ax"]).toBeDefined();
    expect(pkg.scripts["baseline:workflow"]).toBe("bun src/cli.ts baseline workflow");
    expect(pkg.scripts["baseline:skill"]).toBe("bun src/cli.ts baseline skill");
    expect(pkg.scripts["optimize:workflow"]).toBe("bun src/cli.ts optimize workflow");
    expect(pkg.scripts["optimize:skill"]).toBe("bun src/cli.ts optimize skill");
    expect(pkg.scripts["evaluate:workflow"]).toBe("bun src/cli.ts evaluate workflow");
    expect(pkg.scripts["evaluate:skill"]).toBe("bun src/cli.ts evaluate skill");
    expect(pkg.scripts["candidates:skill"]).toBe("bun src/cli.ts candidates skill");
  });

  test("env example is proxy-friendly and does not require a direct OpenAI key", () => {
    const envExample = read(join(AX_DIR, ".env.example"));
    expect(envExample).toContain("AX_BASE_URL=http://127.0.0.1:8317/v1");
    expect(envExample).toContain("AX_API_KEY=dummy");
    expect(envExample).toContain("AX_HEADERS_JSON=");
  });

  test("local notes explain reload rules only after promoted skill changes", () => {
    const notes = read(join(AX_DIR, "README.txt"));
    expect(notes).toContain("Running experiments does not require reloads.");
    expect(notes).toContain("bun run sync:local");
    expect(notes).toContain("restart the agent session");
  });

  test("sample datasets exist for workflow and skill optimization", () => {
    const workflow = read(join(AX_DIR, "datasets", "workflow-routing.sample.jsonl")).trim().split("\n").map((line) => JSON.parse(line));
    const skill = read(join(AX_DIR, "datasets", "skill-optimizer.sample.jsonl")).trim().split("\n").map((line) => JSON.parse(line));

    expect(workflow.length).toBeGreaterThan(0);
    expect(skill.length).toBeGreaterThan(0);
    expect(workflow[0].expected.nextCommand).toContain("wiki ");
    expect(skill[0].expected.mustInclude).toContain("sync:local");
  });

  test("skill candidate targets point at real repo-owned skill files", () => {
    const targets = JSON.parse(read(join(AX_DIR, "targets", "skill-candidates.json")));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((target: { sourcePath: string }) => target.sourcePath === "skills/wiki/SKILL.md")).toBe(true);
    expect(targets.some((target: { sourcePath: string }) => target.sourcePath === "skills/forge/SKILL.md")).toBe(true);
  });
});
