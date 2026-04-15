import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { VAULT_ROOT } from "../constants";

export function walkMarkdown(root: string): string[] {
  // TODO: migrate to async exists()
  if (!existsSync(root)) {
    return [];
  }
  return Array.from(new Bun.Glob("**/*.md").scanSync({ cwd: root, absolute: true, onlyFiles: true }));
}

export function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function stripMarkdownExtension(value: string) {
  return value.endsWith(".md") ? value.slice(0, -3) : value;
}

export function toVaultPath(file: string) {
  return stripMarkdownExtension(normalizePath(relative(VAULT_ROOT, file)));
}

export function fromQmdFile(value: string) {
  if (/^qmd:\/\/[^/]+\//u.test(value)) {
    return normalizePath(value.replace(/^qmd:\/\/[^/]+\//u, ""));
  }
  const resolvedValue = resolve(value);
  const resolvedVault = resolve(VAULT_ROOT);
  if (resolvedValue === resolvedVault || resolvedValue.startsWith(`${resolvedVault}/`)) {
    return normalizePath(relative(resolvedVault, resolvedValue));
  }
  return normalizePath(value);
}

export function isNonMarkdownAttachment(target: string) {
  return /\.[^.]+$/u.test(target) && !target.toLowerCase().endsWith(".md");
}
