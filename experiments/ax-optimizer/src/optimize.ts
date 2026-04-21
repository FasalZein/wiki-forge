import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AxGEPA, AxOptimizedProgramImpl } from "@ax-llm/ax";
import type { AxAI } from "@ax-llm/ax";

import { loadConfig } from "./config";
import { loadDataset } from "./dataset";
import { skillMetric, workflowMetric } from "./metrics";
import { createProgram } from "./programs";
import { createAi, createProgramWithOptimization } from "./runtime";
import { loadSkillCandidateTargets } from "./targets";
import type { OptimizeTarget, ScoreCard, SkillCandidateTarget, SkillExample, WorkflowExample } from "./types";

type PreparedWorkflowExample = Omit<WorkflowExample["input"], "allowedCommands" | "forbiddenCommands"> & {
  allowedCommands: string;
  forbiddenCommands: string;
  _expected: WorkflowExample["expected"];
};

type PreparedSkillExample = Omit<SkillExample["input"], "requiredPhrases" | "forbiddenPhrases"> & {
  requiredPhrases: string;
  forbiddenPhrases: string;
  _expected: SkillExample["expected"];
};

function averageScores(scores: ScoreCard[]) {
  const totals = new Map<string, number>();
  for (const score of scores) {
    for (const [key, value] of Object.entries(score)) {
      totals.set(key, (totals.get(key) || 0) + value);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([key, total]) => [key, total / scores.length]),
  );
}

async function ensureOutputsDir() {
  await mkdir(join(import.meta.dir, "..", "outputs"), { recursive: true });
}

async function writeJsonOutput(name: string, payload: unknown) {
  await ensureOutputsDir();
  const path = join(import.meta.dir, "..", "outputs", name);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

async function evaluateWorkflow(program: ReturnType<typeof createProgram>, student: AxAI, examples: WorkflowExample[]) {
  const scores: ScoreCard[] = [];
  for (const example of examples) {
    const prediction = await program.forward(student, buildWorkflowProgramInput(example.input, example.expected));
    scores.push(await workflowMetric({ prediction: prediction as Record<string, unknown>, example }));
  }
  return averageScores(scores);
}

async function evaluateSkill(program: ReturnType<typeof createProgram>, student: AxAI, examples: SkillExample[]) {
  const scores: ScoreCard[] = [];
  for (const example of examples) {
    const prediction = await program.forward(student, buildSkillProgramInput(example.input, example.expected));
    scores.push(await skillMetric({ prediction: prediction as Record<string, unknown>, example }));
  }
  return averageScores(scores);
}

function prepareWorkflowExamples(examples: WorkflowExample[]) {
  return examples.map((example): PreparedWorkflowExample => ({
    ...buildWorkflowProgramInput(example.input, example.expected),
    _expected: example.expected,
  }));
}

function prepareSkillExamples(examples: SkillExample[]) {
  return examples.map((example): PreparedSkillExample => ({
    ...buildSkillProgramInput(example.input, example.expected),
    _expected: example.expected,
  }));
}

function buildSkillProgramInput(
  input: SkillExample["input"],
  expected: Pick<SkillExample["expected"], "mustInclude" | "mustAvoid">,
) {
  const requiredPhrases = input.requiredPhrases ?? expected.mustInclude;
  const forbiddenPhrases = input.forbiddenPhrases ?? expected.mustAvoid ?? [];
  return {
    ...input,
    requiredPhrases: requiredPhrases.join("\n"),
    forbiddenPhrases: forbiddenPhrases.join("\n"),
  };
}

function buildWorkflowProgramInput(
  input: WorkflowExample["input"],
  expected: Pick<WorkflowExample["expected"], "nextCommand" | "forbiddenCommands">,
) {
  const allowedCommands = input.allowedCommands ?? [expected.nextCommand];
  const forbiddenCommands = input.forbiddenCommands ?? expected.forbiddenCommands ?? [];
  return {
    ...input,
    allowedCommands: allowedCommands.join("\n"),
    forbiddenCommands: forbiddenCommands.join("\n"),
  };
}

export async function runBaseline(target: OptimizeTarget) {
  const student = createAi(loadConfig().model);
  if (target === "workflow") {
    const program = createProgram("workflow");
    const examples = await loadDataset("workflow");
    return {
      target,
      mode: "baseline",
      scores: await evaluateWorkflow(program, student, examples),
    };
  }

  const program = createProgram("skill");
  const examples = await loadDataset("skill");
  return {
    target,
    mode: "baseline",
    scores: await evaluateSkill(program, student, examples),
  };
}

export async function runOptimization(target: OptimizeTarget) {
  const config = loadConfig();
  const student = createAi(config.model);
  const teacher = createAi(config.teacherModel);
  const optimizer = new AxGEPA({
    studentAI: student,
    teacherAI: teacher,
    numTrials: 2,
    minibatch: true,
    minibatchSize: 2,
    earlyStoppingTrials: 2,
    minImprovementThreshold: -0.001,
    sampleCount: 1,
    verbose: false,
    debugOptimizer: false,
    seed: 42,
  });

  if (target === "workflow") {
    const program = createProgram("workflow");
    const train = prepareWorkflowExamples(await loadDataset("workflow"));
    const result = await optimizer.compile(
      program as never,
      train as never,
      (async ({
        prediction,
        example,
      }: {
        prediction: Record<string, unknown>;
        example: PreparedWorkflowExample;
      }) => workflowMetric({
        prediction,
        example: {
          id: "prepared-workflow-example",
          input: {
            project: example.project,
            stateSnapshot: example.stateSnapshot,
            currentOutput: example.currentOutput,
            repairContext: example.repairContext,
            goal: example.goal,
            allowedCommands: example.allowedCommands.split("\n").filter(Boolean),
            forbiddenCommands: example.forbiddenCommands.split("\n").filter(Boolean),
          },
          expected: example._expected,
        },
      })) as never,
      {
        auto: "light",
        verbose: false,
        validationExamples: train as never,
        maxMetricCalls: 12,
      },
    );

    await ensureOutputsDir();
    const outputPath = join(import.meta.dir, "..", "outputs", `${target}.optimized-program.json`);
    const optimizedProgram = (result as { optimizedProgram?: unknown }).optimizedProgram;
    if (optimizedProgram) {
      await writeFile(outputPath, JSON.stringify(optimizedProgram, null, 2), "utf8");

      const reloaded = new AxOptimizedProgramImpl(optimizedProgram as ConstructorParameters<typeof AxOptimizedProgramImpl>[0]);
      program.applyOptimization(reloaded);
    }

    return {
      target,
      mode: "optimize",
      outputPath,
      paretoFrontSize: result.paretoFrontSize,
      hypervolume: result.hypervolume ?? null,
      hasOptimizedProgram: Boolean(optimizedProgram),
    };
  }

  const program = createProgram("skill");
  const train = prepareSkillExamples(await loadDataset("skill"));
  const result = await optimizer.compile(
    program as never,
    train as never,
    (async ({
      prediction,
      example,
    }: {
      prediction: Record<string, unknown>;
      example: PreparedSkillExample;
    }) => skillMetric({
      prediction,
      example: {
        id: "prepared-skill-example",
        input: {
          skillName: example.skillName,
          taskBrief: example.taskBrief,
          currentSkill: example.currentSkill,
          acceptanceCriteria: example.acceptanceCriteria,
          repoContext: example.repoContext,
          requiredPhrases: example.requiredPhrases.split("\n").filter(Boolean),
          forbiddenPhrases: example.forbiddenPhrases.split("\n").filter(Boolean),
        },
        expected: example._expected,
      },
    })) as never,
    {
      auto: "light",
      verbose: false,
      validationExamples: train as never,
      maxMetricCalls: 12,
    },
  );

  await ensureOutputsDir();
  const outputPath = join(import.meta.dir, "..", "outputs", `${target}.optimized-program.json`);
  const optimizedProgram = (result as { optimizedProgram?: unknown }).optimizedProgram;
  if (optimizedProgram) {
    await writeFile(outputPath, JSON.stringify(optimizedProgram, null, 2), "utf8");

    // Verify the saved artifact can be loaded and re-applied before reporting success.
    const reloaded = new AxOptimizedProgramImpl(optimizedProgram as ConstructorParameters<typeof AxOptimizedProgramImpl>[0]);
    program.applyOptimization(reloaded);
  }

  return {
    target,
    mode: "optimize",
    outputPath,
    paretoFrontSize: result.paretoFrontSize,
    hypervolume: result.hypervolume ?? null,
    hasOptimizedProgram: Boolean(optimizedProgram),
  };
}

export async function runEvaluation(target: OptimizeTarget) {
  const config = loadConfig();
  const student = createAi(config.model);

  if (target === "workflow") {
    const baselineProgram = createProgram("workflow");
    const { program: optimizedProgram, optimized } = await createProgramWithOptimization("workflow");
    const examples = await loadDataset("workflow");
    const baselineScores = await evaluateWorkflow(baselineProgram, student, examples);
    const optimizedScores = await evaluateWorkflow(optimizedProgram, student, examples);
    const outputPath = await writeJsonOutput("workflow.evaluation.json", {
      target,
      baselineScores,
      optimizedScores,
      hasOptimizedProgram: Boolean(optimized),
    });
    return { target, outputPath, baselineScores, optimizedScores, hasOptimizedProgram: Boolean(optimized) };
  }

  const baselineProgram = createProgram("skill");
  const { program: optimizedProgram, optimized } = await createProgramWithOptimization("skill");
  const examples = await loadDataset("skill");
  const baselineScores = await evaluateSkill(baselineProgram, student, examples);
  const optimizedScores = await evaluateSkill(optimizedProgram, student, examples);
  const outputPath = await writeJsonOutput("skill.evaluation.json", {
    target,
    baselineScores,
    optimizedScores,
    hasOptimizedProgram: Boolean(optimized),
  });
  return { target, outputPath, baselineScores, optimizedScores, hasOptimizedProgram: Boolean(optimized) };
}

async function generateSkillCandidate(
  target: SkillCandidateTarget,
  currentSkill: string,
) {
  const config = loadConfig();
  const generator = createAi(config.teacherModel);
  const { program } = await createProgramWithOptimization("skill");
  const prediction = await program.forward(generator, {
    ...buildSkillProgramInput(
      {
        skillName: target.skillName,
        taskBrief: target.taskBrief,
        currentSkill,
        acceptanceCriteria: target.acceptanceCriteria,
        repoContext: target.repoContext,
        requiredPhrases: target.mustInclude,
        forbiddenPhrases: target.mustAvoid,
      },
      {
        mustInclude: target.mustInclude ?? [],
        mustAvoid: target.mustAvoid ?? [],
      },
    ),
  }) as {
    revisedSkill: string;
    rationale: string;
    rolloutNote: string;
  };

  return {
    skillName: target.skillName,
    sourcePath: target.sourcePath,
    revisedSkill: normalizeGeneratedText(prediction.revisedSkill),
    rationale: prediction.rationale,
    rolloutNote: prediction.rolloutNote,
  };
}

function normalizeGeneratedText(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function renderSkillCandidateMarkdown(candidate: {
  skillName: string;
  sourcePath: string;
  revisedSkill: string;
  rationale: string;
  rolloutNote: string;
}) {
  return [
    `# ${candidate.skillName} Candidate`,
    "",
    `- source: ${candidate.sourcePath}`,
    "",
    "## Rationale",
    "",
    candidate.rationale,
    "",
    "## Rollout Note",
    "",
    candidate.rolloutNote,
    "",
    "## Suggested Revision",
    "",
    candidate.revisedSkill,
    "",
  ].join("\n");
}

export async function runSkillCandidates() {
  const targets = await loadSkillCandidateTargets();
  const outDir = join(import.meta.dir, "..", "outputs", "skill-candidates");
  await mkdir(outDir, { recursive: true });

  const generated = [];
  for (const target of targets) {
    const sourcePath = join(import.meta.dir, "..", "..", "..", target.sourcePath);
    const currentSkill = await readFile(sourcePath, "utf8");
    const candidate = await generateSkillCandidate(target, currentSkill);
    const jsonPath = join(outDir, `${target.skillName}.candidate.json`);
    const markdownPath = join(outDir, `${target.skillName}.candidate.md`);
    await writeFile(jsonPath, JSON.stringify(candidate, null, 2), "utf8");
    await writeFile(markdownPath, renderSkillCandidateMarkdown(candidate), "utf8");
    generated.push({ skillName: target.skillName, jsonPath, markdownPath });
  }

  return { generated };
}
