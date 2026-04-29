import { describe, expect, test } from "bun:test";
import type { AcceptedChangeSet, ChangeSetDraft } from "../../src/forge/kernel/changeset";
import { inspectChangeSetReadiness } from "../../src/forge/kernel/changeset";
import type { KernelIntent } from "../../src/forge/kernel/intent";
import { acceptKernelIntent, rejectKernelIntent } from "../../src/forge/kernel/result";
import {
  KERNEL_REJECTION_CODES,
  createKernelRejection,
  getKernelRejectionRecoveryCommands,
} from "../../src/forge/kernel/rejection";

const intent: KernelIntent = {
  kind: "intent",
  id: "intent-start-212",
  type: "forge-start",
  actor: {
    kind: "agent",
    id: "codex",
  },
  context: {
    project: "wiki-forge",
    sliceId: "WIKI-FORGE-212",
    requestedAt: "2026-04-28T04:00:00.000Z",
  },
  payload: {
    sliceId: "WIKI-FORGE-212",
    agent: "codex",
  },
};

const changeSet: AcceptedChangeSet = {
  kind: "accepted-changeset",
  id: "changeset-start-212",
  intentId: intent.id,
  createdAt: "2026-04-28T04:00:01.000Z",
  authority: {
    scope: "forge-lifecycle",
    fieldAuthority: "authored",
    actorId: "codex",
    reason: "Claim active slice through Forge lifecycle intent.",
  },
  targetRecords: [
    {
      kind: "slice",
      project: "wiki-forge",
      id: "WIKI-FORGE-212",
      path: "projects/wiki-forge/forge/slices/WIKI-FORGE-212/index.md",
    },
  ],
  operations: [
    {
      kind: "update-record",
      target: {
        kind: "slice",
        project: "wiki-forge",
        id: "WIKI-FORGE-212",
        path: "projects/wiki-forge/forge/slices/WIKI-FORGE-212/index.md",
      },
      fields: [
        {
          name: "status",
          authority: "authored",
          value: "in-progress",
        },
      ],
    },
  ],
  affectedFiles: [
    {
      path: "projects/wiki-forge/forge/slices/WIKI-FORGE-212/index.md",
      authority: "authored",
      reason: "Slice claim is recorded on the task hub.",
    },
  ],
};

describe("forge kernel intent/result primitives", () => {
  test("an accepted kernel result carries a changeset and no rejection", () => {
    const result = acceptKernelIntent(intent, changeSet);

    expect(result.status).toBe("accepted");
    expect(result.changeset.id).toBe("changeset-start-212");
    expect(result.changeset.authority.scope).toBe("forge-lifecycle");
    expect("rejection" in result).toBe(false);
  });

  test("a rejected kernel result carries a stable rejection code and recovery hints", () => {
    const rejection = createKernelRejection({
      code: "AnotherSliceActive",
      reason: "Only one active slice is allowed for a project.",
      invariant: "single-active-slice",
      affected: {
        records: [
          {
            kind: "active-claim",
            project: "wiki-forge",
            id: "WIKI-FORGE-210",
          },
        ],
        files: [
          {
            path: "projects/wiki-forge/forge/slices/WIKI-FORGE-210/index.md",
            reason: "Existing active claim blocks the requested slice.",
          },
        ],
      },
      recovery: [
        {
          command: "wiki forge status wiki-forge WIKI-FORGE-210 --repo . --json",
          description: "Inspect the active slice before attempting takeover or closeout.",
          safeToRetry: true,
        },
      ],
    });

    const result = rejectKernelIntent(intent, rejection);

    expect(result.status).toBe("rejected");
    expect(result.rejection.code).toBe("AnotherSliceActive");
    expect(KERNEL_REJECTION_CODES).toContain(result.rejection.code);
    expect(result.rejection.recovery[0]?.command).toContain("wiki forge status");
    expect("changeset" in result).toBe(false);
  });

  test("a changeset must declare authority and target records before commit", () => {
    const draftWithoutAuthority: ChangeSetDraft = {
      id: "changeset-draft",
      intentId: intent.id,
      targetRecords: changeSet.targetRecords,
    };
    const draftWithoutTargets: ChangeSetDraft = {
      id: "changeset-draft",
      intentId: intent.id,
      authority: changeSet.authority,
      targetRecords: [],
    };

    expect(inspectChangeSetReadiness(draftWithoutAuthority)).toEqual({
      status: "not-ready",
      missing: ["authority"],
    });
    expect(inspectChangeSetReadiness(draftWithoutTargets)).toEqual({
      status: "not-ready",
      missing: ["targetRecords"],
    });
    expect(inspectChangeSetReadiness(changeSet)).toEqual({ status: "ready" });
  });

  test("CLI rendering can use rejection structure without parsing free-text errors", () => {
    const rejection = createKernelRejection({
      code: "MissingTddEvidence",
      reason: "The slice cannot close until TDD evidence is recorded.",
      invariant: "required-evidence-before-close",
      affected: {
        records: [
          {
            kind: "slice",
            project: "wiki-forge",
            id: "WIKI-FORGE-212",
          },
        ],
        files: [],
      },
      recovery: [
        {
          command: "wiki forge evidence wiki-forge WIKI-FORGE-212 tdd --help",
          description: "Record red/green TDD evidence for the active slice.",
        },
      ],
    });

    const rendered = [
      `rejected:${rejection.code}`,
      `invariant:${rejection.invariant}`,
      ...getKernelRejectionRecoveryCommands(rejection),
    ].join("\n");

    expect(rendered).toContain("rejected:MissingTddEvidence");
    expect(rendered).toContain("invariant:required-evidence-before-close");
    expect(rendered).toContain("wiki forge evidence wiki-forge WIKI-FORGE-212 tdd --help");
    expect(rendered).not.toContain(rejection.reason);
  });
});
