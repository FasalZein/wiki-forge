import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, tempDir } from "../../test-helpers";
import { readSliceHub, updateSliceHub, readAllSliceIds, nextSliceId } from "../../../src/forge/vault/slice-repository";
import { forgeSlicePath, forgeSliceDir } from "../../../src/forge/vault/forge-paths";

afterEach(() => {
  cleanupTempPaths();
});

function createSliceHub(vault: string, project: string, sliceId: string, overrides: Record<string, unknown> = {}) {
  const dir = join(vault, forgeSliceDir(project, sliceId));
  mkdirSync(dir, { recursive: true });
  const frontmatter = {
    title: `${sliceId} Test slice`,
    type: "forge-slice",
    project,
    task_id: sliceId,
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    review_policy: { required_approvals: 1 },
    ...overrides,
  };
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return `${key}:\n${Object.entries(value).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`;
      }
      return `${key}: ${value}`;
    })
    .join("\n");
  writeFileSync(
    join(vault, forgeSlicePath(project, sliceId)),
    `---\n${yaml}\n---\n# ${sliceId}\n\nSlice content.\n`,
    "utf8",
  );
}

describe("SliceDocumentRepository", () => {
  describe("readSliceHub", () => {
    test("reads an existing slice hub and returns frontmatter + content", async () => {
      const vault = tempDir("wiki-repo-read");
      createSliceHub(vault, "test-proj", "TEST-001", { status: "in-progress", claimed_by: "agent" });

      const result = await readSliceHub(vault, "test-proj", "TEST-001");

      expect(result.path).toBe("projects/test-proj/forge/slices/TEST-001/index.md");
      expect(Object.keys(result.data).sort()).toEqual(["claimed_by", "created_at", "project", "review_policy", "status", "task_id", "title", "type", "updated"]);
      expect(result.data.title).toBe("TEST-001 Test slice");
      expect(result.data.status).toBe("in-progress");
      expect(result.data.claimed_by).toBe("agent");
      expect(result.data.task_id).toBe("TEST-001");
      expect(result.content).toContain("# TEST-001");
      expect(result.content).toContain("Slice content.");
    });

    test("throws when slice hub does not exist", async () => {
      const vault = tempDir("wiki-repo-notfound");
      await expect(readSliceHub(vault, "test-proj", "MISSING-001")).rejects.toThrow(/not found/);
    });
  });

  describe("updateSliceHub", () => {
    test("adds frontmatter fields and removes specified keys", async () => {
      const vault = tempDir("wiki-repo-update");
      createSliceHub(vault, "test-proj", "TEST-002");

      await updateSliceHub(vault, "test-proj", "TEST-002", { status: "in-progress", claimed_by: "bot" }, ["review_policy"]);

      const result = await readSliceHub(vault, "test-proj", "TEST-002");
      expect(result.data.status).toBe("in-progress");
      expect(result.data.claimed_by).toBe("bot");
      expect(result.data.review_policy).toBeUndefined();
      // Unchanged fields are preserved
      expect(result.data.title).toBe("TEST-002 Test slice");
      expect(result.data.project).toBe("test-proj");
    });

    test("throws when slice hub does not exist", async () => {
      const vault = tempDir("wiki-repo-update-missing");
      await expect(updateSliceHub(vault, "test-proj", "MISSING-002", { status: "done" }, [])).rejects.toThrow(/not found/);
    });
  });

  describe("readAllSliceIds", () => {
    test("returns all slice IDs in a project", async () => {
      const vault = tempDir("wiki-repo-list");
      createSliceHub(vault, "test-proj", "TEST-001");
      createSliceHub(vault, "test-proj", "TEST-002");
      createSliceHub(vault, "test-proj", "TEST-010");

      const ids = await readAllSliceIds(vault, "test-proj");

      expect(ids).toContain("TEST-001");
      expect(ids).toContain("TEST-002");
      expect(ids).toContain("TEST-010");
      expect(ids.length).toBe(3);
    });

    test("returns empty array when project has no slices", async () => {
      const vault = tempDir("wiki-repo-list-empty");
      const ids = await readAllSliceIds(vault, "test-proj");
      expect(ids).toEqual([]);
    });
  });

  describe("nextSliceId", () => {
    test("returns prefix-001 for empty list", () => {
      expect(nextSliceId([], "test")).toBe("TEST-001");
    });

    test("returns next sequential ID", () => {
      expect(nextSliceId(["TEST-001", "TEST-002", "TEST-003"], "test")).toBe("TEST-004");
    });

    test("handles gaps in sequence", () => {
      expect(nextSliceId(["TEST-001", "TEST-003", "TEST-010"], "test")).toBe("TEST-011");
    });

    test("handles non-sequential naming", () => {
      expect(nextSliceId(["FOO-005", "BAR-003"], "test")).toBe("TEST-001");
    });

    test("follows highest existing number for matching prefix", () => {
      expect(nextSliceId(["TEST-099", "OTHER-200", "TEST-100"], "test")).toBe("TEST-101");
    });

    test("starts at 001 for project with no matching slices", () => {
      expect(nextSliceId(["OTHER-001", "ANOTHER-005"], "test")).toBe("TEST-001");
    });
  });
});
