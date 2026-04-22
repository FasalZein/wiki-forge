import { parseWikiMarkdown } from "../lib/markdown-ast";

export type VerificationCommandSpec = {
  command: string;
  label: string | null;
  expectedExitCode: number;
  stdoutContains: string[];
  stderrContains: string[];
};

export function extractVerificationSpecs(markdown: string): VerificationCommandSpec[] {
  return parseWikiMarkdown(markdown).codeBlocks
    .filter((block) => block.lang === "bash" || block.lang === "sh" || block.lang === "shell")
    .map((block) => parseVerificationCommandSpec(block.value));
}

export function extractVerificationSpecsFromTestPlan(
  markdown: string,
  data: Record<string, unknown> | undefined,
): VerificationCommandSpec[] {
  const blockSpecs = extractVerificationSpecs(markdown);
  if (blockSpecs.length) return blockSpecs;
  return extractFrontmatterVerificationSpecs(data?.verification_commands);
}

export function extractShellCommandBlocks(markdown: string) {
  return extractVerificationSpecs(markdown).map((spec) => spec.command);
}

function parseVerificationCommandSpec(block: string): VerificationCommandSpec {
  const stdoutContains: string[] = [];
  const stderrContains: string[] = [];
  let label: string | null = null;
  let expectedExitCode = 0;
  const commandLines: string[] = [];
  let parsingDirectives = true;

  for (const rawLine of block.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (parsingDirectives) {
      if (!trimmed) continue;
      const directive = parseVerificationDirective(trimmed);
      if (directive) {
        if (directive.kind === "label") label = directive.value;
        else if (directive.kind === "expected-exit-code") expectedExitCode = directive.value;
        else if (directive.kind === "stdout-contains") stdoutContains.push(directive.value);
        else stderrContains.push(directive.value);
        continue;
      }
      parsingDirectives = false;
    }
    commandLines.push(rawLine);
  }

  const command = commandLines.join("\n").trim();
  if (!command) throw new Error("verification command block is missing a command");
  return { command, label, expectedExitCode, stdoutContains, stderrContains };
}

function parseVerificationDirective(line: string):
  | { kind: "label"; value: string }
  | { kind: "expected-exit-code"; value: number }
  | { kind: "stdout-contains" | "stderr-contains"; value: string }
  | null {
  const match = line.match(/^#\s*([a-z0-9-]+)\s*:\s*(.+)$/iu);
  if (!match) return null;
  const [, key, rawValue] = match;
  const value = rawValue.trim();
  if (!value) throw new Error(`verification directive is missing a value: ${line}`);
  switch (key.toLowerCase()) {
    case "label":
      return { kind: "label", value };
    case "expect-exit-code": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed)) throw new Error(`invalid expect-exit-code value: ${value}`);
      return { kind: "expected-exit-code", value: parsed };
    }
    case "expect-stdout-contains":
      return { kind: "stdout-contains", value };
    case "expect-stderr-contains":
      return { kind: "stderr-contains", value };
    default:
      if (key.toLowerCase().startsWith("expect-")) throw new Error(`unsupported verification directive: ${key}`);
      return null;
  }
}

function extractFrontmatterVerificationSpecs(value: unknown): VerificationCommandSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object")
    .map((entry) => {
      const command = typeof entry.command === "string" ? entry.command.trim() : "";
      if (!command) return null;
      return {
        command,
        label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
        expectedExitCode: Number.isInteger(entry.expected_exit_code) ? Number(entry.expected_exit_code) : 0,
        stdoutContains: Array.isArray(entry.stdout_contains) ? entry.stdout_contains.map(String).map((item) => item.trim()).filter(Boolean) : [],
        stderrContains: Array.isArray(entry.stderr_contains) ? entry.stderr_contains.map(String).map((item) => item.trim()).filter(Boolean) : [],
      } satisfies VerificationCommandSpec;
    })
    .filter((entry): entry is VerificationCommandSpec => entry !== null);
}
