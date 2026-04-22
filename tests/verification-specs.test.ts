import { describe, expect, test } from "bun:test";
import {
  extractShellCommandBlocks,
  extractVerificationSpecs,
  extractVerificationSpecsFromTestPlan,
} from "../src/verification/verification-specs";

describe("verification specs", () => {
  test("parses directive-prefixed shell blocks into verification specs", () => {
    const markdown = `
## Verification Commands

\`\`\`bash
# label: expected nonzero
# expect-exit-code: 3
# expect-stdout-contains: hello
# expect-stderr-contains: expected failure
echo hello
echo expected failure >&2
exit 3
\`\`\`
`;

    expect(extractVerificationSpecs(markdown)).toEqual([
      {
        command: "echo hello\necho expected failure >&2\nexit 3",
        label: "expected nonzero",
        expectedExitCode: 3,
        stdoutContains: ["hello"],
        stderrContains: ["expected failure"],
      },
    ]);
  });

  test("falls back to frontmatter verification_commands when no shell block exists", () => {
    expect(extractVerificationSpecsFromTestPlan(
      "## Red Tests\n\n- [x] frontmatter commands can drive verification\n",
      {
        verification_commands: [
          { command: "bun test tests/other.test.ts" },
        ],
      },
    )).toEqual([
      {
        command: "bun test tests/other.test.ts",
        label: null,
        expectedExitCode: 0,
        stdoutContains: [],
        stderrContains: [],
      },
    ]);
  });

  test("extracts only shell command text from parsed verification specs", () => {
    const markdown = `
\`\`\`bash
echo first
\`\`\`

\`\`\`sh
echo second
\`\`\`

\`\`\`typescript
console.log("ignored");
\`\`\`
`;

    expect(extractShellCommandBlocks(markdown)).toEqual([
      "echo first",
      "echo second",
    ]);
  });
});
