import type { CommandHandler } from "../types";
import {
  v1ForgeAmend,
  v1ForgeCheck,
  v1ForgeClose,
  v1ForgeEvidence,
  v1ForgeNext,
  v1ForgePlan,
  v1ForgeRelease,
  v1ForgeReview,
  v1ForgeRun,
  v1ForgeStart,
  v1ForgeStatus,
} from "../v1/cli/commands";

export const FORGE_COMMANDS: Record<string, CommandHandler> = {
  "forge:start": (args) => v1ForgeStart(args),
  "forge:check": (args) => v1ForgeCheck(args),
  "forge:close": (args) => v1ForgeClose(args),
  "forge:run": (args) => v1ForgeRun(args),
  "forge:evidence": (args) => v1ForgeEvidence(args),
  "forge:review": (args) => v1ForgeReview(args),
  "forge:status": (args) => v1ForgeStatus(args),
  "forge:plan": (args) => v1ForgePlan(args),
  "forge:next": (args) => v1ForgeNext(args),
  "forge:amend": (args) => v1ForgeAmend(args),
  "forge:release": (args) => v1ForgeRelease(args),
};

const FORGE_SUBCOMMANDS = {
  start: "forge:start",
  check: "forge:check",
  close: "forge:close",
  run: "forge:run",
  evidence: "forge:evidence",
  review: "forge:review",
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
