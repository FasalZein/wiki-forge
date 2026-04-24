#!/usr/bin/env bun

import { measureOutputText } from "../src/lib/token-budget";

function printLine(line = "") {
  process.stdout.write(`${line}\n`);
}

function printJson(value: unknown) {
  printLine(JSON.stringify(value, null, 2));
}

function printError(line = "") {
  process.stderr.write(`${line}\n`);
}


const args = process.argv.slice(2);

if (args.length === 0) {
  printError("usage: bun scripts/wiki-output-tokens.ts <wiki-args...>");
  process.exit(1);
}

const proc = Bun.spawnSync([process.execPath, "src/index.ts", ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdout: "pipe",
  stderr: "pipe",
});

const stdout = proc.stdout.toString();
const stderr = proc.stderr.toString();

printJson({
  command: args,
  exitCode: proc.exitCode,
  stdout: measureOutputText(stdout),
  stderr: measureOutputText(stderr),
});

process.exit(proc.exitCode);
