import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./_helpers/wiki-subprocess";

describe("Forge-owned source layout", () => {
  test("Forge status lives inside the Forge bounded context", () => {
    expect(existsSync(join(repoRoot, "src/forge/status"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/protocol/status"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/forge-status.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/forge-status-format.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/forge-status-ledger.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/forge-status-triage.ts"))).toBe(false);
  });

  test("Forge steering lives inside the Forge bounded context", () => {
    expect(existsSync(join(repoRoot, "src/forge/steering"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/protocol/steering"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/steering.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/protocol/steering-triage.ts"))).toBe(false);
  });
});
