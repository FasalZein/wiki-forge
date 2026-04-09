import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export async function readText(path: string) {
  return Bun.file(path).text();
}

export async function readJson<T>(path: string) {
  return Bun.file(path).json() as Promise<T>;
}

export async function exists(path: string) {
  return Bun.file(path).exists();
}

export async function writeText(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

export function statFingerprint(path: string) {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}
