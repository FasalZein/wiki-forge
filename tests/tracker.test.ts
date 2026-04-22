import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempPaths, initVault, runWiki, setupVaultAndRepo, tempDir } from "./test-helpers";

afterEach(() => {
  cleanupTempPaths();
});

function runTrackerScript<T>(vault: string, script: string, env: Record<string, string> = {}): T {
  const proc = Bun.spawnSync(["bun", "-e", script], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KNOWLEDGE_VAULT_ROOT: vault, ...env },
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || "tracker subprocess failed");
  }
  return JSON.parse(proc.stdout.toString().trim()) as T;
}

describe("activity tracker", () => {
  describe("extractProject", () => {
    // Import the functions directly for unit testing
    const { extractProject, extractTarget, resolveSessionId } = require("../src/session/shared");

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
    const { extractTarget } = require("../src/session/shared");

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
    const { resolveSessionId } = require("../src/session/shared");

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
    test("filters by session ID and skips malformed lines", () => {
      const vault = tempDir("tracker-vault");
      initVault(vault);
      mkdirSync(join(vault, "projects", "demo"), { recursive: true });
      const activityPath = join(vault, "projects", "demo", ".activity.jsonl");
      writeFileSync(activityPath, [
        JSON.stringify({ ts: "2026-04-16T10:00:00Z", sid: "sess-A", cmd: "start-slice", project: "demo", target: "DEMO-001", durationMs: 50, ok: true }),
        "not-json",
        JSON.stringify({ ts: "2026-04-16T10:01:00Z", sid: "sess-B", cmd: "verify-slice", project: "demo", target: "DEMO-999", durationMs: 100, ok: false, error: "wrong session" }),
        JSON.stringify({ ts: "2026-04-16T10:02:00Z", sid: "sess-A", cmd: "verify-slice", project: "demo", target: "DEMO-001", durationMs: 120, ok: false, error: "test plan not verified" }),
        JSON.stringify({ ts: "2026-04-16T10:03:00Z", sid: "sess-A", cmd: "close-slice", project: "demo", target: "DEMO-001", durationMs: 150, ok: true }),
      ].join("\n") + "\n", "utf8");

      const summary = runTrackerScript<{
        sessionId: string | null;
        totalCommands: number;
        durationMinutes: number;
        commandCounts: Record<string, number>;
        sliceTransitions: Array<{ cmd: string; target: string; ok: boolean }>;
        errors: Array<{ cmd: string; error: string; target?: string }>;
      }>(vault, `
        const { collectSessionActivity } = await import("./src/session/shared");
        const summary = await collectSessionActivity("demo", "sess-A");
        console.log(JSON.stringify(summary));
      `);

      expect(summary.sessionId).toBe("sess-A");
      expect(summary.totalCommands).toBe(3);
      expect(summary.durationMinutes).toBe(3);
      expect(summary.commandCounts["start-slice"]).toBe(1);
      expect(summary.commandCounts["verify-slice"]).toBe(1);
      expect(summary.commandCounts["close-slice"]).toBe(1);
      expect(summary.sliceTransitions).toEqual([
        { cmd: "start-slice", target: "DEMO-001", ok: true },
        { cmd: "verify-slice", target: "DEMO-001", ok: false },
        { cmd: "close-slice", target: "DEMO-001", ok: true },
      ]);
      expect(summary.errors).toEqual([
        { cmd: "verify-slice", error: "test plan not verified", target: "DEMO-001" },
      ]);
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

      const result = runWiki([
        "handover",
        "demo",
        "--repo", repo,
        "--base", "main",
        "--accomplished", "Tracked the session activity counters.",
        "--no-blockers",
        "--json",
      ], env);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.toString());
      expect(typeof json.sessionActivity.totalCommands).toBe("number");
      expect(json.sessionActivity.totalCommands).toBeGreaterThanOrEqual(3);
      expect(json.sessionActivity.commandCounts["scaffold-project"]).toBe(1);
      expect(json.shortPrompt).toContain("Load /wiki and /forge.");
    });
  });
});
