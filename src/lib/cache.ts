import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VAULT_ROOT } from "../constants";

const CACHE_ROOT = join(VAULT_ROOT, ".cache", "wiki-cli");

type CacheEnvelope<T> = {
  version: string;
  fingerprint: string;
  value: T;
};

function cachePath(namespace: string, key: string) {
  return join(CACHE_ROOT, namespace, `${hashKey(key)}.json`);
}

export function readCache<T>(namespace: string, key: string, version: string, fingerprint: string): T | null {
  const filePath = cachePath(namespace, key);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as CacheEnvelope<T>;
    if (parsed.version !== version || parsed.fingerprint !== fingerprint) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(namespace: string, key: string, version: string, fingerprint: string, value: T) {
  const filePath = cachePath(namespace, key);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ version, fingerprint, value }), "utf8");
}

export function fileFingerprint(filePath: string) {
  if (!existsSync(filePath)) {
    return "missing";
  }
  const stat = statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

export function filesFingerprint(files: string[]) {
  const parts = files
    .slice()
    .sort()
    .map((filePath) => `${filePath}:${fileFingerprint(filePath)}`);
  return hashKey(parts.join("|"));
}

function hashKey(value: string) {
  return Bun.hash(value).toString(16);
}
