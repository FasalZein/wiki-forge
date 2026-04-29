import type { CommandHandler } from "../types";
import {
  forgeAmendCommand,
  forgeCheckCommand,
  forgeCloseCommand,
  forgeEvidenceCommand,
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
  review: "forge:review",
  tdd: "forge:tdd",
  status: "forge:status",
  plan: "forge:plan",
  next: "forge:next",
  amend: "forge:amend",
  release: "forge:release",
} as const;

export function resolveForgeCommand(rest: string[]) {
  const [subcommand, ...subArgs] = rest;
  if (!subcommand || subcommand === "help") throw new Error("missing forge subcommand. Run 'wiki help' for usage.");
  const mapped = FORGE_SUBCOMMANDS[subcommand as keyof typeof FORGE_SUBCOMMANDS];
  if (!mapped) throw new Error(`unknown forge subcommand: ${subcommand}. Run 'wiki help' for usage.`);
  return { command: mapped, args: subArgs };
}
