#!/usr/bin/env bun

import { measureOutputText } from "../src/lib/token-budget";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("usage: bun scripts/wiki-output-tokens.ts <wiki-args...>");
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

console.log(JSON.stringify({
  command: args,
  exitCode: proc.exitCode,
  stdout: measureOutputText(stdout),
  stderr: measureOutputText(stderr),
}, null, 2));

process.exit(proc.exitCode);
