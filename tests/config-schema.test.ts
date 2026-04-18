import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schemaPath = join(process.cwd(), "schemas", "wiki.config.schema.json");

describe("schemas/wiki.config.schema.json", () => {
  test("exists and parses as valid JSON", () => {
    const raw = readFileSync(schemaPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.$schema).toBeDefined();
    expect(parsed.$id).toBeDefined();
  });

  test("describes the repo.ignore key as a string array", () => {
    const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
    expect(parsed.properties.repo.properties.ignore.type).toBe("array");
    expect(parsed.properties.repo.properties.ignore.items.type).toBe("string");
  });

  test("$id is a well-formed URL so editors can resolve it", () => {
    const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
    expect(() => new URL(parsed.$id)).not.toThrow();
  });
});
