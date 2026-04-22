import { join } from "node:path";
import { VAULT_ROOT } from "../constants";
import { exists, readJson, statFingerprint, writeText } from "./fs";

const CACHE_ROOT = join(VAULT_ROOT, ".cache", "wiki-cli");

type CacheEnvelope<T> = {
  version: string;
  fingerprint: string;
  value: T;
};

function cachePath(namespace: string, key: string) {
  return join(CACHE_ROOT, namespace, `${hashKey(key)}.json`);
}

export async function readCache<T>(namespace: string, key: string, version: string, fingerprint: string): Promise<T | null> {
  const filePath = cachePath(namespace, key);
  if (!(await exists(filePath))) {
    return null;
  }

  try {
    const parsed = await readJson<CacheEnvelope<T>>(filePath);
    if (parsed.version !== version || parsed.fingerprint !== fingerprint) {
      return null;
    }
    return parsed.value;
  } catch (error) {
    return handleCacheReadFailure(error);
  }
}

function handleCacheReadFailure(_error: unknown): null {
  // Cache reads stay best-effort: malformed or unreadable cache entries fall
  // back to a cache miss so callers recompute from source-of-truth inputs.
  return null;
}

export async function writeCache<T>(namespace: string, key: string, version: string, fingerprint: string, value: T) {
  const filePath = cachePath(namespace, key);
  await writeText(filePath, JSON.stringify({ version, fingerprint, value }));
}

export function fileFingerprint(filePath: string) {
  return statFingerprint(filePath);
}

export function filesFingerprint(files: string[]) {
  // walkMarkdown returns glob output which is already sorted, so .sort() is
  // usually a no-op. We keep it for correctness when callers pass unsorted
  // arrays, but note that it produces an unnecessary copy on the hot path.
  const parts = files
    .slice()
    .sort()
    .map((filePath) => `${filePath}:${fileFingerprint(filePath)}`);
  return hashKey(parts.join("|"));
}

function hashKey(value: string) {
  return Bun.hash(value).toString(16);
}
