import { describe, expect, test } from "bun:test";
import { renderKernelRejectionJson, renderKernelRejectionText } from "../../src/forge/workflow/render-rejection";
import { evaluateForgeNext } from "../../src/forge/lifecycle/next-intent";
import { parseVaultDocument } from "../../src/forge/vault/frontmatter-codec";
import { classifyLegacyDocument } from "../../src/forge/vault/legacy-classifier";

describe("forge recovery rendering", () => {
  test("typed rejections render concise actionable recovery without string parsing", () => {
    const projection = evaluateForgeNext({
      project: "wiki-forge",
      slices: [
        { project: "wiki-forge", taskId: "WIKI-FORGE-216", title: "first", status: "in-progress" },
        { project: "wiki-forge", taskId: "WIKI-FORGE-217", title: "second", status: "in-progress" },
      ],
    });
    if (projection.status !== "conflict") throw new Error("expected conflict");

    expect(renderKernelRejectionText(projection.rejection)).toBe([
      "rejected MultipleActiveSlices: single-active-slice",
      "next: wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217 --reason \"release before starting <next-slice>\"",
    ].join("\n"));
    const parsed = JSON.parse(renderKernelRejectionJson(projection.rejection));
    expect(parsed.code).toBe("MultipleActiveSlices");
    expect(parsed.invariant).toBe("single-active-slice");
    expect(parsed.recovery[0].command).toBe("wiki forge release wiki-forge WIKI-FORGE-216, WIKI-FORGE-217 --reason \"release before starting <next-slice>\"");
  });

  test("repairable and quarantined old docs render diagnostics, not guessed next actions", () => {
    const repairable = classifyLegacyDocument(parseVaultDocument(
      "projects/wiki-forge/forge/slices/WIKI-FORGE-217/index.md",
      `---\ntitle: WIKI-FORGE-217\ntype: forge-slice\nproject: wiki-forge\nstatus: ready\n---\n# missing task id\n`,
    ));
    const quarantined = classifyLegacyDocument(parseVaultDocument(
      "projects/wiki-forge/notes/random.md",
      `---\ntitle: Random\nproject: wiki-forge\n---\n# random\n`,
    ));

    expect(evaluateForgeNext({
      project: "wiki-forge",
      slices: [],
      legacyClassifications: [repairable, quarantined],
    })).toEqual({
      status: "needs-repair",
      project: "wiki-forge",
      source: "canonical-records",
      diagnostics: [
        "MissingRequiredField: slice record is missing required field: task_id",
        "InvalidFieldType: slice record spec_kind must be task-hub",
        "UnknownLifecycleShape: document has project metadata but no recognized canonical record kind",
      ],
    });
  });
});
