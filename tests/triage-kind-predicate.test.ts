import { describe, expect, test } from "bun:test";
import { PRE_PHASE_TRIAGE_KINDS, isPrePhaseTriage } from "../src/protocol/steering/triage-types";

describe("forge triage kinds", () => {
  test("matches only the declared pre-phase kinds", () => {
    for (const kind of PRE_PHASE_TRIAGE_KINDS) {
      expect(isPrePhaseTriage({ kind })).toBe(true);
    }

    expect(isPrePhaseTriage({ kind: "fill-docs" })).toBe(false);
    expect(isPrePhaseTriage({ kind: "continue-active-slice" })).toBe(false);
    expect(isPrePhaseTriage({ kind: "resume-failed-forge" })).toBe(false);
    expect(isPrePhaseTriage({ kind: "needs-typo" as never })).toBe(false);
  });
});
