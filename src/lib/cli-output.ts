export function printLine(line = "") {
  process.stdout.write(`${line}\n`);
}

export function printJson(value: unknown) {
  printLine(JSON.stringify(value, null, 2));
}

export function printError(line = "") {
  process.stderr.write(`${line}\n`);
}
