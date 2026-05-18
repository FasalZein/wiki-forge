export function readPositionalArgs(args: readonly string[], valueFlags: readonly string[]): readonly string[] {
  const valueFlagSet = new Set(valueFlags);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueFlagSet.has(arg)) index += 1;
      continue;
    }
    positional.push(arg);
  }

  return positional;
}

export function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readRepeatedFlagValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing ${flag}`);
    values.push(value.replaceAll("\\", "/"));
    index += 1;
  }

  return values;
}
