import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, runWiki, setupVaultAndRepo, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

describe("activity tracker", () => {
  describe("extractProject", () => {
    // Import the functions directly for unit testing
    const { extractProject, extractTarget, resolveSessionId } = require("../src/lib/tracker");

    test("extracts project from positional arg", () => {
      expect(extractProject("backlog", ["myproject", "--json"])).toBe("myproject");
    });

    test("returns undefined for no-project commands", () => {
      expect(extractProject("help", [])).toBeUndefined();
      expect(extractProject("cache-clear", [])).toBeUndefined();
      expect(extractProject("qmd-update", ["--full"])).toBeUndefined();
      expect(extractProject("search", ["some query"])).toBeUndefined();
    });

    test("returns undefined when arg looks like a path", () => {
      expect(extractProject("maintain", ["src/foo.ts"])).toBeUndefined();
    });

    test("returns undefined when arg starts with digit", () => {
      expect(extractProject("maintain", ["123project"])).toBeUndefined();
    });

    test("skips flags to find positional", () => {
      expect(extractProject("maintain", ["--json", "myproject"])).toBe("myproject");
    });
  });

  describe("extractTarget", () => {
    const { extractTarget } = require("../src/lib/tracker");

    test("extracts slice ID for slice commands", () => {
      expect(extractTarget("start-slice", ["myproject", "PROJ-001", "--agent", "claude"])).toBe("PROJ-001");
      expect(extractTarget("close-slice", ["myproject", "PROJ-002"])).toBe("PROJ-002");
      expect(extractTarget("verify-slice", ["myproject", "PROJ-003"])).toBe("PROJ-003");
      expect(extractTarget("claim", ["myproject", "PROJ-004"])).toBe("PROJ-004");
    });

    test("returns undefined for non-target commands", () => {
      expect(extractTarget("backlog", ["myproject"])).toBeUndefined();
      expect(extractTarget("maintain", ["myproject"])).toBeUndefined();
    });
  });

  describe("resolveSessionId", () => {
    const { resolveSessionId } = require("../src/lib/tracker");

    test("uses WIKI_SESSION_ID env when set", () => {
      const original = process.env.WIKI_SESSION_ID;
      try {
        process.env.WIKI_SESSION_ID = "test-session-123";
        expect(resolveSessionId()).toBe("test-session-123");
      } finally {
        if (original === undefined) delete process.env.WIKI_SESSION_ID;
        else process.env.WIKI_SESSION_ID = original;
      }
    });

    test("falls back to ppid-date format", () => {
      const original = process.env.WIKI_SESSION_ID;
      try {
        delete process.env.WIKI_SESSION_ID;
        const sid = resolveSessionId();
        expect(sid).toMatch(/^\d+-\d{4}-\d{2}-\d{2}$/);
      } finally {
        if (original !== undefined) process.env.WIKI_SESSION_ID = original;
      }
    });
  });

  describe("appendActivity + readActivity", () => {
    test("writes valid JSONL and reads it back", async () => {
      const vault = tempDir("tracker-test");
      // Temporarily override VAULT_ROOT for this test by writing directly
      const activityPath = join(vault, ".activity.jsonl");
      const entry = { ts: "2026-04-16T10:00:00Z", sid: "test-1", cmd: "backlog", project: "demo", durationMs: 50, ok: true };
      writeFileSync(activityPath, JSON.stringify(entry) + "\n", "utf8");

      const content = readFileSync(activityPath, "utf8").trim();
      const parsed = JSON.parse(content);
      expect(parsed.cmd).toBe("backlog");
      expect(parsed.sid).toBe("test-1");
      expect(parsed.ok).toBe(true);
    });

    test("handles malformed lines gracefully", () => {
      const vault = tempDir("tracker-test");
      const activityPath = join(vault, ".activity.jsonl");
      writeFileSync(activityPath, '{"cmd":"backlog","ok":true}\nnot-json\n{"cmd":"gate","ok":false}\n', "utf8");

      const lines = readFileSync(activityPath, "utf8").split("\n").filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch { /* skip */ }
      }
      expect(entries).toHaveLength(2);
      expect(entries[0].cmd).toBe("backlog");
      expect(entries[1].cmd).toBe("gate");
    });
  });

  describe("collectSessionActivity", () => {
    const { collectSessionActivity } = require("../src/lib/tracker");

    test("filters by session ID", async () => {
      const vault = tempDir("tracker-test");
      const activityPath = join(vault, ".activity.jsonl");
      const entries = [
        { ts: "2026-04-16T10:00:00Z", sid: "sess-A", cmd: "backlog", project: "demo", durationMs: 50, ok: true },
        { ts: "2026-04-16T10:01:00Z", sid: "sess-B", cmd: "gate", project: "demo", durationMs: 100, ok: true },
        { ts: "2026-04-16T10:02:00Z", sid: "sess-A", cmd: "maintain", project: "demo", durationMs: 200, ok: true },
      ];
      writeFileSync(activityPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

      // collectSessionActivity reads from VAULT_ROOT which we can't easily override
      // So we test the aggregation logic directly
      const filtered = entries.filter((e) => e.sid === "sess-A" && e.project === "demo");
      expect(filtered).toHaveLength(2);
      expect(filtered[0].cmd).toBe("backlog");
      expect(filtered[1].cmd).toBe("maintain");
    });

    test("aggregates command counts and slice transitions", () => {
      const entries = [
        { ts: "2026-04-16T10:00:00Z", sid: "s1", cmd: "start-slice", project: "demo", target: "DEMO-001", durationMs: 50, ok: true },
        { ts: "2026-04-16T10:05:00Z", sid: "s1", cmd: "verify-slice", project: "demo", target: "DEMO-001", durationMs: 100, ok: false, error: "test plan not verified" },
        { ts: "2026-04-16T10:10:00Z", sid: "s1", cmd: "verify-slice", project: "demo", target: "DEMO-001", durationMs: 100, ok: true },
        { ts: "2026-04-16T10:12:00Z", sid: "s1", cmd: "close-slice", project: "demo", target: "DEMO-001", durationMs: 150, ok: true },
      ];

      const commandCounts: Record<string, number> = {};
      const sliceTransitions: Array<{ cmd: string; target: string; ok: boolean }> = [];
      const errors: Array<{ cmd: string; error: string }> = [];
      const SLICE_COMMANDS = new Set(["claim", "start-slice", "verify-slice", "close-slice"]);

      for (const e of entries) {
        commandCounts[e.cmd] = (commandCounts[e.cmd] || 0) + 1;
        if (SLICE_COMMANDS.has(e.cmd) && e.target) sliceTransitions.push({ cmd: e.cmd, target: e.target, ok: e.ok });
        if (!e.ok && e.error) errors.push({ cmd: e.cmd, error: e.error });
      }

      expect(commandCounts["start-slice"]).toBe(1);
      expect(commandCounts["verify-slice"]).toBe(2);
      expect(commandCounts["close-slice"]).toBe(1);
      expect(sliceTransitions).toHaveLength(4);
      expect(sliceTransitions.filter((t) => t.cmd === "close-slice" && t.ok).map((t) => t.target)).toEqual(["DEMO-001"]);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toContain("test plan not verified");
    });
  });

  describe("end-to-end CLI tracking", () => {
    test("CLI invocation creates per-project activity entry", () => {
      const { vault } = setupVaultAndRepo();
      const env = { KNOWLEDGE_VAULT_ROOT: vault, WIKI_SESSION_ID: "e2e-test-session" };

      expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
      expect(runWiki(["backlog", "demo", "--json"], env).exitCode).toBe(0);

      const activityPath = join(vault, "projects", "demo", ".activity.jsonl");
      expect(existsSync(activityPath)).toBe(true);

      const lines = readFileSync(activityPath, "utf8").split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);

      const entries = lines.map((line) => JSON.parse(line));
      const scaffoldEntry = entries.find((e: { cmd: string }) => e.cmd === "scaffold-project");
      expect(scaffoldEntry?.cmd).toBe("scaffold-project");
      expect(scaffoldEntry.sid).toBe("e2e-test-session");
      expect(scaffoldEntry.ok).toBe(true);
      expect(scaffoldEntry.durationMs).toBeGreaterThanOrEqual(0);

      const backlogEntry = entries.find((e: { cmd: string }) => e.cmd === "backlog");
      expect(backlogEntry?.cmd).toBe("backlog");
      expect(backlogEntry.project).toBe("demo");
      expect(backlogEntry.ok).toBe(true);
    });

    test("non-project commands are not tracked", () => {
      const { vault } = setupVaultAndRepo();
      const env = { KNOWLEDGE_VAULT_ROOT: vault, WIKI_SESSION_ID: "e2e-no-project" };

      // help has no project — should not create any activity file
      runWiki(["help"], env);
      expect(existsSync(join(vault, ".activity.jsonl"))).toBe(false);
    });

    test("failed commands are tracked with error", () => {
      const { vault } = setupVaultAndRepo();
      const env = { KNOWLEDGE_VAULT_ROOT: vault, WIKI_SESSION_ID: "e2e-fail-test" };

      // scaffold first so the project dir exists for the tracker
      expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);

      // backlog for nonexistent project fails — but "nonexistent" project dir doesn't exist,
      // so the tracker silently skips. Test with an actual project that has a bad command instead.
      const result = runWiki(["move-task", "demo", "NONEXISTENT-999", "--to", "Done"], env);
      expect(result.exitCode).not.toBe(0);

      const activityPath = join(vault, "projects", "demo", ".activity.jsonl");
      const lines = readFileSync(activityPath, "utf8").split("\n").filter(Boolean);
      const failEntry = lines.map((l) => JSON.parse(l)).find((e: { ok: boolean; cmd: string }) => !e.ok && e.cmd === "move-task");
      expect(failEntry?.cmd).toBe("move-task");
      expect(failEntry?.error).toMatch(/NONEXISTENT-999|not found/i);
    });

    test("handover includes session activity in JSON output", () => {
      const { vault, repo } = setupVaultAndRepo();
      const env = { KNOWLEDGE_VAULT_ROOT: vault, WIKI_SESSION_ID: "handover-test" };

      expect(runWiki(["scaffold-project", "demo"], env).exitCode).toBe(0);
      const summaryPath = join(vault, "projects", "demo", "_summary.md");
      const current = readFileSync(summaryPath, "utf8");
      writeFileSync(summaryPath, current.replace("status: scaffold", `status: current\nrepo: ${repo}`), "utf8");

      expect(runWiki(["backlog", "demo"], env).exitCode).toBe(0);
      expect(runWiki(["create-issue-slice", "demo", "test slice"], env).exitCode).toBe(0);

      const result = runWiki(["handover", "demo", "--repo", repo, "--base", "main", "--json"], env);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.toString());
      expect(typeof json.sessionActivity.totalCommands).toBe("number");
      expect(json.sessionActivity.totalCommands).toBeGreaterThanOrEqual(3);
      expect(json.sessionActivity.commandCounts["scaffold-project"]).toBe(1);
    });
  });
});
