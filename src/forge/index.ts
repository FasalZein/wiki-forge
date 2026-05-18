import type { CommandHandler } from "../shared/contracts/command";
import { printLine } from "../lib/cli-output";
import {
  forgeAmendCommand,
  forgeCheckCommand,
  forgeCloseCommand,
  forgeEvidenceCommand,
  forgeGrillCommand,
  forgeImproveCommand,
  forgeNextCommand,
  forgePlanCommand,
  forgeReleaseCommand,
  forgeReviewCommand,
  forgeRunCommand,
  forgeStartCommand,
  forgeStatusCommand,
  forgeTddCommand,
} from "./workflow/commands";

export const FORGE_COMMANDS: Record<string, CommandHandler> = {
  "forge:start": (args) => forgeStartCommand(args),
  "forge:check": (args) => forgeCheckCommand(args),
  "forge:close": (args) => forgeCloseCommand(args),
  "forge:run": (args) => forgeRunCommand(args),
  "forge:evidence": (args) => forgeEvidenceCommand(args),
  "forge:grill": (args) => forgeGrillCommand(args),
  "forge:improve": (args) => forgeImproveCommand(args),
  "forge:review": (args) => forgeReviewCommand(args),
  "forge:tdd": (args) => forgeTddCommand(args),
  "forge:status": (args) => forgeStatusCommand(args),
  "forge:plan": (args) => forgePlanCommand(args),
  "forge:next": (args) => forgeNextCommand(args),
  "forge:amend": (args) => forgeAmendCommand(args),
  "forge:release": (args) => forgeReleaseCommand(args),
};

const FORGE_SUBCOMMANDS = {
  start: "forge:start",
  check: "forge:check",
  close: "forge:close",
  run: "forge:run",
  evidence: "forge:evidence",
  grill: "forge:grill",
  improve: "forge:improve",
  review: "forge:review",
  tdd: "forge:tdd",
  status: "forge:status",
  plan: "forge:plan",
  next: "forge:next",
  amend: "forge:amend",
  release: "forge:release",
} as const;

const FORGE_HELP = `wiki forge — Tracked implementation workflow.

Operator commands:
  wiki forge plan <project> <feature-name> [--repo <path>] [--plan-answer-file <path>]
  wiki forge next <project>
  wiki forge status <project> [slice-id] [--json]
  wiki forge run <project> [slice-id] --repo <path>
  wiki forge improve <project> [--json]
  wiki forge grill record <project> [--context-file <path>] [--decision-title <title> --decision-file <path>] [--tag <id> ...] [--json]

Internal / repair:
  wiki forge start <project> [slice-id] [--agent <name>] [--repo <path>] [--json]
  wiki forge check <project> [slice-id] [--repo <path>] [--base <rev>] [--json]
  wiki forge close <project> [slice-id] [--repo <path>] [--base <rev>] [--json]
  wiki forge tdd status|cycle|red|green <project> <slice-id> [flags...]
  wiki forge evidence <project> <slice-id> verify --command <cmd> [--json]
  wiki forge review record <project> <slice-id> --verdict <v> --reviewer <name>
  wiki forge amend <project> <closed-slice-id> --reason <text> [--start] [--json]
  wiki forge release <project> <slice-id>

Run 'wiki help --all' for the full catalog.
`;

export function resolveForgeCommand(rest: string[]) {
  const [subcommand, ...subArgs] = rest;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printLine(FORGE_HELP);
    process.exit(0);
  }
  const mapped = FORGE_SUBCOMMANDS[subcommand as keyof typeof FORGE_SUBCOMMANDS];
  if (!mapped) throw new Error(`unknown forge subcommand: ${subcommand}. Run 'wiki forge help' for usage.`);
  return { command: mapped, args: subArgs };
}
