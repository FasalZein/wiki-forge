const commandCache = new Map<string, string | null>();

export function resolveCommandOnPath(command: string) {
  if (commandCache.has(command)) return commandCache.get(command) ?? null;
  const resolved = Bun.which(command) ?? null;
  commandCache.set(command, resolved);
  return resolved;
}

export function assertCommandOnPath(command: string, message: string) {
  if (resolveCommandOnPath(command)) return;
  throw new Error(message);
}
