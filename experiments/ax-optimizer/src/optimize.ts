import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AxAI, AxGEPA, AxOptimizedProgramImpl } from "@ax-llm/ax";

import { loadConfig } from "./config";
import { loadDataset } from "./dataset";
import { skillMetric, workflowMetric } from "./metrics";
import { createProgram } from "./programs";
import type { OptimizeTarget, ScoreCard, SkillExample, WorkflowExample } from "./types";

type PreparedWorkflowExample = WorkflowExample["input"] & {
  _expected: WorkflowExample["expected"];
};

type PreparedSkillExample = SkillExample["input"] & {
  _expected: SkillExample["expected"];
};

function createAi(model: string) {
  const config = loadConfig();
  return new AxAI({
    name: config.provider as never,
    apiKey: config.apiKey,
    apiURL: config.apiURL,
    config: {
      model,
      ...(config.headers ? { headers: config.headers } : {}),
    },
  });
}

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

async function evaluateWorkflow(program: ReturnType<typeof createProgram>, student: AxAI, examples: WorkflowExample[]) {
  const scores: ScoreCard[] = [];
  for (const example of examples) {
    const prediction = await program.forward(student, example.input);
    scores.push(await workflowMetric({ prediction: prediction as Record<string, unknown>, example }));
  }
  return averageScores(scores);
}

async function evaluateSkill(program: ReturnType<typeof createProgram>, student: AxAI, examples: SkillExample[]) {
  const scores: ScoreCard[] = [];
  for (const example of examples) {
    const prediction = await program.forward(student, example.input);
    scores.push(await skillMetric({ prediction: prediction as Record<string, unknown>, example }));
  }
  return averageScores(scores);
}

function prepareWorkflowExamples(examples: WorkflowExample[]) {
  return examples.map((example): PreparedWorkflowExample => ({
    ...example.input,
    _expected: example.expected,
  }));
}

function prepareSkillExamples(examples: SkillExample[]) {
  return examples.map((example): PreparedSkillExample => ({
    ...example.input,
    _expected: example.expected,
  }));
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

    await mkdir(join(import.meta.dir, "..", "outputs"), { recursive: true });
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

  await mkdir(join(import.meta.dir, "..", "outputs"), { recursive: true });
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
