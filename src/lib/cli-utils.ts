/** Shared lightweight CLI-argument helpers used across multiple domains. */

export function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function defaultAgentName() {
  return process.env.PI_AGENT_NAME || process.env.CLAUDE_AGENT_NAME || process.env.USER || "agent";
}
