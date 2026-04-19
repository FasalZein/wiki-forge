import { describe, expect, test } from "bun:test";
import { runWiki } from "./_helpers/wiki-subprocess";

describe("wiki schema cli", () => {
  test("schema --list enumerates known spec kinds", () => {
    const result = runWiki(["schema", "--list"]);

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain("slice-hub");
    expect(output).toContain("plan");
    expect(output).toContain("test-plan");
    expect(output).toContain("prd");
    expect(output).toContain("feature");
  });

  test("schema slice-hub prints a json schema-like object", () => {
    const result = runWiki(["schema", "slice-hub"]);

    expect(result.exitCode).toBe(0);
    const json = result.json<{ required: string[]; properties: Record<string, unknown> }>();
    expect(Array.isArray(json.required)).toBe(true);
    expect(typeof json.properties).toBe("object");
    expect(json.required).toContain("task_id");
    expect("source_paths" in json.properties).toBe(true);
  });

  test("schema unknown-kind fails clearly", () => {
    const result = runWiki(["schema", "unknown-kind"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown schema kind");
  });
});
