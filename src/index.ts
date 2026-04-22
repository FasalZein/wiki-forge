#!/usr/bin/env bun

import { appendActivity, extractProject, extractTarget, resolveAgent, resolveSessionId } from "./session/shared";
import { WIKI_COMMANDS, resolveWikiCommand } from "./wiki";

const rawArgs = process.argv.slice(2);
const { command, args } = resolveWikiCommand(rawArgs);
const sessionId = resolveSessionId();
const agent = resolveAgent();

try {
  if (args.includes("--help") || args.includes("-h")) {
    await WIKI_COMMANDS.help(args);
    process.exit(0);
  }
  const handler = WIKI_COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}. Run 'wiki help' for usage.`);
  }
  const start = Date.now();
  let ok = true;
  let errorMsg: string | undefined;
  try {
    await handler(args);
  } catch (handlerError) {
    ok = false;
    errorMsg = (handlerError instanceof Error ? handlerError.message : String(handlerError)).slice(0, 200);
    throw handlerError;
  } finally {
    appendActivity({
      ts: new Date().toISOString(),
      sid: sessionId,
      cmd: command,
      project: extractProject(command, args),
      target: extractTarget(command, args),
      agent,
      durationMs: Date.now() - start,
      ok,
      ...(errorMsg ? { error: errorMsg } : {}),
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = typeof error === "object" && error !== null && "exitCode" in error && typeof (error as { exitCode?: unknown }).exitCode === "number"
    ? (error as { exitCode: number }).exitCode
    : 1;
  console.error(`error: ${message}`);
  process.exit(exitCode);
}
