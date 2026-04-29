export type VaultPath = string;

export type ParsedProjectPath = {
  readonly project: string;
  readonly rest: readonly string[];
};

export function parseProjectPath(path: VaultPath): ParsedProjectPath | null {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts[0] !== "projects" || !parts[1]) return null;
  return {
    project: parts[1],
    rest: parts.slice(2),
  };
}

export function inferProjectFromPath(path: VaultPath): string | null {
  return parseProjectPath(path)?.project ?? null;
}

export function isSliceHubPath(path: VaultPath): boolean {
  const parsed = parseProjectPath(path);
  if (!parsed) return false;
  const [forge, slices, sliceId, fileName] = parsed.rest;
  return forge === "forge" && slices === "slices" && Boolean(sliceId) && fileName === "index.md";
}

export function isProjectIndexPath(path: VaultPath): boolean {
  const parsed = parseProjectPath(path);
  if (!parsed) return false;
  return parsed.rest.length === 1 && parsed.rest[0] === "index.md";
}

export function isProjectionPath(path: VaultPath): boolean {
  const parsed = parseProjectPath(path);
  if (!parsed) return false;
  const filename = parsed.rest[parsed.rest.length - 1] ?? "";
  return filename === "backlog.md" || filename === "status.md" || filename === "resume.md" || filename === "handover.md";
}
