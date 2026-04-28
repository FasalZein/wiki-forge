export function shouldUseV1ForgeNext(args: readonly string[]): boolean {
  if (args.includes("--prompt") || args.includes("--prompt-json") || args.includes("--all")) return false;
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseV1ForgeStatus(args: readonly string[]): boolean {
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseV1ForgeStart(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseV1ForgeRelease(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseV1ForgePlan(args: readonly string[]): boolean {
  return args.some((arg) => !arg.startsWith("--"));
}

export function shouldUseV1ForgeClose(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseV1ForgeCheck(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseV1ForgeAmend(args: readonly string[]): boolean {
  return hasProjectAndSlice(args);
}

export function shouldUseV1ForgeRun(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 1;
}

export function shouldUseV1ForgeEvidence(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 3;
}

export function shouldUseV1ForgeReview(args: readonly string[]): boolean {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  return positional[0] === "record" && positional.length >= 3;
}

function hasProjectAndSlice(args: readonly string[]): boolean {
  return args.filter((arg) => !arg.startsWith("--")).length >= 2;
}
