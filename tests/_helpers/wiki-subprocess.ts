export const repoRoot = process.cwd();

type WikiEnv = Record<string, string>;

type WikiRunConfig = {
  vault?: string;
  cwd?: string;
  env?: WikiEnv;
};

export type WikiRunResult = ReturnType<typeof Bun.spawnSync> & {
  json<T>(): T;
};

function isConfig(value: WikiEnv | WikiRunConfig): value is WikiRunConfig {
  return "vault" in value || "cwd" in value || "env" in value;
}

export function runWiki(args: string[], envOrConfig: WikiEnv | WikiRunConfig = {}): WikiRunResult {
  const config = isConfig(envOrConfig) ? envOrConfig : { env: envOrConfig };
  const env = {
    ...process.env,
    ...(config.vault ? { KNOWLEDGE_VAULT_ROOT: config.vault } : {}),
    ...(config.env ?? {}),
  };
  const result = Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
    cwd: config.cwd ?? repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return Object.assign(result, {
    json<T>() {
      return JSON.parse(result.stdout.toString()) as T;
    },
  });
}
