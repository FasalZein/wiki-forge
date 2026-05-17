import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SkillAuditFile = {
  readonly localPath: string;
  readonly upstreamPath: string;
  readonly requiredAnchors: readonly string[];
  readonly auxiliary?: boolean;
};

export type SkillAuditConfig = {
  readonly upstreamRoot: string;
  readonly files: readonly SkillAuditFile[];
  readonly intentionallyUnmappedUpstreamSkills: readonly string[];
};

export type SkillAuditFailure = {
  readonly localPath: string;
  readonly upstreamPath: string;
  readonly reason: string;
};

export type SkillAuditFileResult = SkillAuditFile & {
  readonly missingAnchors: readonly string[];
  readonly preservesUpstreamContent: boolean;
};

export type SkillAuditResult = {
  readonly ok: boolean;
  readonly checkedFiles: number;
  readonly files: readonly SkillAuditFileResult[];
  readonly failures: readonly SkillAuditFailure[];
};

export const upstreamSkillAuditConfig: SkillAuditConfig = {
  upstreamRoot: "/Users/tothemoon/Dev/AI/Skills/mattpocock-skills",
  intentionallyUnmappedUpstreamSkills: [],
  files: [
    {
      localPath: "skills/tdd/SKILL.md",
      upstreamPath: "skills/engineering/tdd/SKILL.md",
      requiredAnchors: [
        "Tests should verify behavior through public interfaces, not implementation details",
        "DO NOT write all tests first, then all implementation",
        "Vertical slices via tracer bullets",
        "Ask: \"What should the public interface look like? Which behaviors are most important to test?\"",
      ],
    },
    {
      localPath: "skills/tdd/tests.md",
      upstreamPath: "skills/engineering/tdd/tests.md",
      auxiliary: true,
      requiredAnchors: ["Integration-style", "Implementation-detail tests", "Tests behavior users/callers care about"],
    },
    {
      localPath: "skills/tdd/mocking.md",
      upstreamPath: "skills/engineering/tdd/mocking.md",
      auxiliary: true,
      requiredAnchors: ["Mock at **system boundaries** only", "Designing for Mockability", "Use dependency injection"],
    },
    {
      localPath: "skills/tdd/interface-design.md",
      upstreamPath: "skills/engineering/tdd/interface-design.md",
      auxiliary: true,
      requiredAnchors: ["Interface Design for Testability", "Accept dependencies, don't create them", "Small surface area"],
    },
    {
      localPath: "skills/tdd/deep-modules.md",
      upstreamPath: "skills/engineering/tdd/deep-modules.md",
      auxiliary: true,
      requiredAnchors: ["Deep Modules", "small interface + lots of implementation", "Shallow module"],
    },
    {
      localPath: "skills/tdd/refactoring.md",
      upstreamPath: "skills/engineering/tdd/refactoring.md",
      auxiliary: true,
      requiredAnchors: ["Refactor Candidates", "Duplication", "Shallow modules"],
    },
    {
      localPath: "skills/grill-with-docs/SKILL.md",
      upstreamPath: "skills/engineering/grill-with-docs/SKILL.md",
      requiredAnchors: [
        "Interview me relentlessly about every aspect of this plan",
        "Ask the questions one at a time",
        "If a question can be answered by exploring the codebase, explore the codebase instead",
        "Update CONTEXT.md inline",
        "Offer ADRs sparingly",
        "If a `CONTEXT-MAP.md` exists at the root",
        "Storage mapping is the adapter",
      ],
    },
    {
      localPath: "skills/grill-with-docs/CONTEXT-FORMAT.md",
      upstreamPath: "skills/engineering/grill-with-docs/CONTEXT-FORMAT.md",
      auxiliary: true,
      requiredAnchors: [
        "## Structure",
        "## Rules",
        "## Single vs multi-context repos",
        "Do not force large projects into one giant glossary file",
        "projects/<project>/architecture/context-map.md",
        "projects/<project>/architecture/contexts/<context>.md",
      ],
    },
    {
      localPath: "skills/grill-with-docs/ADR-FORMAT.md",
      upstreamPath: "skills/engineering/grill-with-docs/ADR-FORMAT.md",
      auxiliary: true,
      requiredAnchors: [
        "## Template",
        "An ADR can be a single paragraph",
        "## When to offer an ADR",
        "For wiki-forge projects, ADR bodies live in `projects/<project>/adrs/`",
        "projects/<project>/decisions.md",
      ],
    },
    {
      localPath: "skills/improve-codebase-architecture/SKILL.md",
      upstreamPath: "skills/engineering/improve-codebase-architecture/SKILL.md",
      requiredAnchors: [
        "Use these terms exactly in every suggestion",
        "Deletion test",
        "The interface is the test surface",
        "One adapter = hypothetical seam. Two adapters = real seam.",
        "Do NOT propose interfaces yet",
      ],
    },
    {
      localPath: "skills/improve-codebase-architecture/LANGUAGE.md",
      upstreamPath: "skills/engineering/improve-codebase-architecture/LANGUAGE.md",
      auxiliary: true,
      requiredAnchors: ["## Terms", "**Module**", "**Interface**", "**Depth**", "**Seam**"],
    },
    {
      localPath: "skills/improve-codebase-architecture/DEEPENING.md",
      upstreamPath: "skills/engineering/improve-codebase-architecture/DEEPENING.md",
      auxiliary: true,
      requiredAnchors: ["## Dependency categories", "Remote but owned", "True external", "replace, don't layer"],
    },
    {
      localPath: "skills/improve-codebase-architecture/INTERFACE-DESIGN.md",
      upstreamPath: "skills/engineering/improve-codebase-architecture/INTERFACE-DESIGN.md",
      auxiliary: true,
      requiredAnchors: ["Spawn 3+ sub-agents in parallel", "radically different", "Present and compare"],
    },
    {
      localPath: "skills/diagnose/SKILL.md",
      upstreamPath: "skills/engineering/diagnose/SKILL.md",
      requiredAnchors: ["Build a feedback loop", "Generate **3–5 ranked hypotheses**", "Fix + regression test", "Cleanup + post-mortem"],
    },
    {
      localPath: "skills/diagnose/scripts/hitl-loop.template.sh",
      upstreamPath: "skills/engineering/diagnose/scripts/hitl-loop.template.sh",
      auxiliary: true,
      requiredAnchors: ["Human-in-the-loop reproduction loop", "capture VAR", "ERRORED"],
    },
    {
      localPath: "skills/prototype/SKILL.md",
      upstreamPath: "skills/engineering/prototype/SKILL.md",
      requiredAnchors: ["A prototype is **throwaway code that answers a question**", "Pick a branch", "Delete or absorb when done"],
    },
    {
      localPath: "skills/prototype/LOGIC.md",
      upstreamPath: "skills/engineering/prototype/LOGIC.md",
      auxiliary: true,
      requiredAnchors: ["Logic Prototype", "State the question", "Build the smallest TUI"],
    },
    {
      localPath: "skills/prototype/UI.md",
      upstreamPath: "skills/engineering/prototype/UI.md",
      auxiliary: true,
      requiredAnchors: ["UI Prototype", "Sub-shape A", "floating switcher"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/SKILL.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/SKILL.md",
      requiredAnchors: ["Setup Matt Pocock's Skills", "Issue tracker", "Triage label vocabulary", "Domain docs"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/domain.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/domain.md",
      auxiliary: true,
      requiredAnchors: ["Domain Docs", "Use the glossary's vocabulary", "Flag ADR conflicts"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/issue-tracker-github.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md",
      auxiliary: true,
      requiredAnchors: ["Issue tracker: GitHub", "gh issue create", "fetch the relevant ticket"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/issue-tracker-gitlab.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/issue-tracker-gitlab.md",
      auxiliary: true,
      requiredAnchors: ["Issue tracker: GitLab", "glab issue create", "fetch the relevant ticket"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/issue-tracker-local.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md",
      auxiliary: true,
      requiredAnchors: ["Issue tracker: Local Markdown", ".scratch/<feature-slug>", "fetch the relevant ticket"],
    },
    {
      localPath: "skills/setup-matt-pocock-skills/triage-labels.md",
      upstreamPath: "skills/engineering/setup-matt-pocock-skills/triage-labels.md",
      auxiliary: true,
      requiredAnchors: ["Triage Labels", "needs-triage", "ready-for-agent"],
    },
    {
      localPath: "skills/triage/SKILL.md",
      upstreamPath: "skills/engineering/triage/SKILL.md",
      requiredAnchors: ["Triage", "needs-triage", "ready-for-agent", "Needs-info template"],
    },
    {
      localPath: "skills/triage/AGENT-BRIEF.md",
      upstreamPath: "skills/engineering/triage/AGENT-BRIEF.md",
      auxiliary: true,
      requiredAnchors: ["Writing Agent Briefs", "Durability over precision", "Acceptance criteria"],
    },
    {
      localPath: "skills/triage/OUT-OF-SCOPE.md",
      upstreamPath: "skills/engineering/triage/OUT-OF-SCOPE.md",
      auxiliary: true,
      requiredAnchors: ["Out-of-Scope Knowledge Base", "Prior requests", "When to write to `.out-of-scope/`"],
    },
    {
      localPath: "skills/zoom-out/SKILL.md",
      upstreamPath: "skills/engineering/zoom-out/SKILL.md",
      requiredAnchors: ["Go up a layer of abstraction", "map of all the relevant modules and callers"],
    },
    {
      localPath: "skills/write-a-prd/SKILL.md",
      upstreamPath: "skills/engineering/to-prd/SKILL.md",
      requiredAnchors: [
        "Do NOT interview the user",
        "Use the project's domain glossary vocabulary throughout the PRD",
        "Problem Statement",
        "Implementation Decisions",
        "Testing Decisions",
      ],
    },
    {
      localPath: "skills/prd-to-slices/SKILL.md",
      upstreamPath: "skills/engineering/to-issues/SKILL.md",
      requiredAnchors: [
        "vertical slices",
        "HITL",
        "AFK",
        "Each slice delivers a narrow but COMPLETE path",
        "Prefer many thin slices over few thick ones",
      ],
    },
  ],
};

export function auditUpstreamSkillDrift(input: { readonly repoRoot: string }): SkillAuditResult {
  const files = upstreamSkillAuditConfig.files.map((file): SkillAuditFileResult => {
    const localPath = join(input.repoRoot, file.localPath);
    const upstreamPath = join(upstreamSkillAuditConfig.upstreamRoot, file.upstreamPath);
    const localText = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
    const upstreamText = existsSync(upstreamPath) ? readFileSync(upstreamPath, "utf8") : "";
    const missingAnchors = file.requiredAnchors.filter((anchor) => !localText.includes(anchor));
    const preservesUpstreamContent = upstreamText.length > 0 && normalizeSkillText(localText).includes(normalizeSkillText(upstreamText));

    return {
      ...file,
      missingAnchors,
      preservesUpstreamContent,
    };
  });

  const failures: SkillAuditFailure[] = [];

  for (const file of files) {
    const upstreamPath = join(upstreamSkillAuditConfig.upstreamRoot, file.upstreamPath);
    const localPath = join(input.repoRoot, file.localPath);

    if (!existsSync(upstreamPath)) {
      failures.push({
        localPath: file.localPath,
        upstreamPath: file.upstreamPath,
        reason: "upstream file is missing",
      });
    }

    if (!existsSync(localPath)) {
      failures.push({
        localPath: file.localPath,
        upstreamPath: file.upstreamPath,
        reason: "local skill file is missing",
      });
    }

    if (!file.preservesUpstreamContent) {
      failures.push({
        localPath: file.localPath,
        upstreamPath: file.upstreamPath,
        reason: "local file does not preserve normalized upstream content",
      });
    }

    for (const anchor of file.missingAnchors) {
      failures.push({
        localPath: file.localPath,
        upstreamPath: file.upstreamPath,
        reason: `missing upstream workflow anchor: ${anchor}`,
      });
    }
  }

  return {
    ok: failures.length === 0,
    checkedFiles: files.length,
    files,
    failures,
  };
}

function normalizeSkillText(text: string): string {
  return text
    .replace(/\n?<skill_context>[\s\S]*?<\/skill_context>\n\n/g, "\n")
    .replace(/^name: .*$/gm, "name: <skill-name>")
    .trim();
}

function printResult(result: SkillAuditResult): void {
  if (result.ok) {
    console.log(`upstream skill drift audit passed (${result.checkedFiles} files)`);
    return;
  }

  console.error("upstream skill drift audit failed");
  for (const failure of result.failures) {
    console.error(`- ${failure.localPath} ↔ ${failure.upstreamPath}: ${failure.reason}`);
  }
}

if (import.meta.main) {
  const result = auditUpstreamSkillDrift({ repoRoot: process.cwd() });
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
}
