export function shouldUseForgeNext(args: readonly string[]): boolean {
  if (args.includes("--prompt") || args.includes("--prompt-json") || args.includes("--all")) return false;
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseForgeStatus(args: readonly string[]): boolean {
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseForgeStart(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseForgeRelease(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseForgePlan(args: readonly string[]): boolean {
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseForgeClose(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseForgeCheck(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseForgeAmend(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseForgeRun(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 1;
}

export function shouldUseForgeEvidence(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 3;
}

export function shouldUseForgeReview(args: readonly string[]): boolean {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  return positional[0] === "record" && positional.length >= 3;
}

function hasProjectAndSlice(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 2;
}
