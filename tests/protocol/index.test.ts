import { describe, expect, test } from "bun:test";
import { auditProtocol, syncProtocol } from "../../src/wiki/protocol";

describe("protocol index exports", () => {
  test("re-exports Wiki protocol helpers", () => {
    expect(typeof auditProtocol).toBe("function");
    expect(typeof syncProtocol).toBe("function");
  });
});
