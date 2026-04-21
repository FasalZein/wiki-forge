import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AxAI, AxOptimizedProgramImpl } from "@ax-llm/ax";

import { loadConfig } from "./config";
import { createProgram } from "./programs";
import type { OptimizeTarget } from "./types";

export function createAi(model: string) {
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

export async function loadOptimizedProgram(target: OptimizeTarget) {
  const path = join(import.meta.dir, "..", "outputs", `${target}.optimized-program.json`);
  const raw = await readFile(path, "utf8");
  return new AxOptimizedProgramImpl(JSON.parse(raw) as ConstructorParameters<typeof AxOptimizedProgramImpl>[0]);
}

export async function createProgramWithOptimization(target: OptimizeTarget) {
  const program = target === "workflow" ? createProgram("workflow") : createProgram("skill");
  const optimized = await loadOptimizedProgram(target).catch(() => null);
  if (optimized) program.applyOptimization(optimized);
  return { program, optimized };
}
