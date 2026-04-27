import type { CommandHandler } from "../types";
import { forgeCheck, forgeClose, forgeEvidence, forgeNext, forgeOpen, forgePlan, forgeRelease, forgeReview, forgeRun, forgeSkip, forgeStart, forgeStatus } from "../slice/forge";

export const FORGE_COMMANDS: Record<string, CommandHandler> = {
  "forge:start": (args) => forgeStart(args),
  "forge:open": (args) => forgeOpen(args),
  "forge:check": (args) => forgeCheck(args),
  "forge:close": (args) => forgeClose(args),
  "forge:run": (args) => forgeRun(args),
  "forge:skip": (args) => forgeSkip(args),
  "forge:evidence": (args) => forgeEvidence(args),
  "forge:review": (args) => forgeReview(args),
  "forge:status": (args) => forgeStatus(args),
  "forge:plan": (args) => forgePlan(args),
  "forge:next": (args) => forgeNext(args),
  "forge:release": (args) => forgeRelease(args),
};

export function resolveForgeCommand(rest: string[]) {
  const [subcommand, ...subArgs] = rest;
  if (!subcommand || subcommand === "help") throw new Error("missing forge subcommand. Run 'wiki help' for usage.");
  const mapped = {
    start: "forge:start",
    open: "forge:open",
    check: "forge:check",
    close: "forge:close",
    run: "forge:run",
    skip: "forge:skip",
    evidence: "forge:evidence",
    review: "forge:review",
    status: "forge:status",
    plan: "forge:plan",
    next: "forge:next",
    release: "forge:release",
  }[subcommand as "start" | "open" | "check" | "close" | "run" | "skip" | "evidence" | "review" | "status" | "plan" | "next" | "release"];
  if (!mapped) throw new Error(`unknown forge subcommand: ${subcommand}. Run 'wiki help' for usage.`);
  return { command: mapped, args: subArgs };
}
