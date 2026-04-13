#!/usr/bin/env bun

import { existsSync } from "node:fs";

const HOMEBREW_SQLITE = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
const QMD_CLI_PATH = new URL("../node_modules/@tobilu/qmd/dist/cli/qmd.js", import.meta.url);

if (existsSync(HOMEBREW_SQLITE)) {
  const { Database } = await import("bun:sqlite");
  Database.setCustomSQLite(HOMEBREW_SQLITE);
}

await import(QMD_CLI_PATH.href);
