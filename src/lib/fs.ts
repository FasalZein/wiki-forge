import { appendFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export async function readText(path: string) {
  return Bun.file(path).text();
}

export async function readJson<T>(path: string) {
  return Bun.file(path).json() as Promise<T>;
}

export async function exists(path: string) {
  // Bun.file().exists() returns false for directories; use existsSync to handle both files and dirs
  return existsSync(path);
}

export async function writeText(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

export function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

export function appendText(path: string, content: string) {
  appendFileSync(path, content, "utf8");
}

export async function copyFile(src: string, dest: string) {
  await Bun.write(dest, Bun.file(src));
}

export function listDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export function statFingerprint(path: string) {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}
