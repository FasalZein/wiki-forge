import { describe, expect, test } from "bun:test";
import { collectClosureAttestation } from "../src/forge/core/closure-attestation";
import type { GitTruth } from "../src/forge/core/git-truth";
import { collectSliceOwnershipMap } from "../src/forge/core/ownership-map";

function gitTruth(overrides: Partial<GitTruth> = {}): GitTruth {
  const changedFiles = overrides.changedFiles ?? [];
  return {
    repo: "/repo",
    clean: changedFiles.length === 0,
    staged: [],
    unstaged: [],
    untracked: [],
    deleted: [],
    renamed: [],
    changedFiles,
    counts: { staged: 0, unstaged: 0, untracked: 0, deleted: 0, renamed: 0 },
    fingerprint: "",
    ...overrides,
  };
}

describe("closure attestation", () => {
  test("reports clean/pass readiness when required inputs pass", () => {
    const attestation = collectClosureAttestation({
      gitTruth: gitTruth(),
      ownership: collectSliceOwnershipMap({ changedFiles: ["src/auth.ts"], activeSliceId: "DEMO-001", activeClaimPaths: ["src/auth.ts"] }),
      workflowValidation: { ok: true },
      verification: { status: "pass" },
      review: { status: "pass" },
    });

    expect(attestation.wikiFreshness.status).toBe("pass");
    expect(attestation.git.status).toBe("pass");
    expect(attestation.ownership.status).toBe("pass");
    expect(attestation.overall.status).toBe("pass");
  });

  test("blocks overall readiness when git truth is dirty", () => {
    const attestation = collectClosureAttestation({
      gitTruth: gitTruth({ clean: false, unstaged: ["src/auth.ts"], changedFiles: ["src/auth.ts"], counts: { staged: 0, unstaged: 1, untracked: 0, deleted: 0, renamed: 0 } }),
      workflowValidation: { ok: true },
    });

    expect(attestation.git.status).toBe("blocked");
    expect(attestation.git.files).toEqual(["src/auth.ts"]);
    expect(attestation.overall.status).toBe("blocked");
  });

  test("keeps review and verification pending separate from other passing checks", () => {
    const attestation = collectClosureAttestation({
      gitTruth: gitTruth(),
      workflowValidation: { ok: true },
      verification: { status: "pending", summary: "tests not recorded" },
      review: { status: "pending", summary: "review not complete" },
    });

    expect(attestation.verification.status).toBe("pending");
    expect(attestation.review.status).toBe("pending");
    expect(attestation.overall.status).toBe("pending");
  });

  test("propagates exact unowned ownership files", () => {
    const attestation = collectClosureAttestation({
      gitTruth: gitTruth(),
      ownership: collectSliceOwnershipMap({ changedFiles: ["src/auth.ts", "src/outside.ts"], activeSliceId: "DEMO-001", activeClaimPaths: ["src/auth.ts"] }),
      workflowValidation: { ok: true },
    });

    expect(attestation.ownership.status).toBe("blocked");
    expect(attestation.ownership.files).toEqual(["src/outside.ts"]);
    expect(attestation.overall.status).toBe("blocked");
  });
});
