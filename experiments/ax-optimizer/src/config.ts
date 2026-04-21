import "dotenv/config";

import type { OptimizeConfig } from "./types";

function parseHeaders(raw: string | undefined) {
  if (!raw || !raw.trim()) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AX_HEADERS_JSON must be a JSON object");
  }

  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new Error(`AX_HEADERS_JSON value for ${key} must be a string`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

export function loadConfig(): OptimizeConfig {
  return {
    provider: process.env.AX_PROVIDER?.trim() || "openai",
    apiURL: process.env.AX_BASE_URL?.trim() || "http://127.0.0.1:8317/v1",
    apiKey: process.env.AX_API_KEY?.trim() || process.env.OPENAI_APIKEY?.trim() || "dummy",
    model: process.env.AX_MODEL?.trim() || "gpt-5.4-mini",
    teacherModel: process.env.AX_TEACHER_MODEL?.trim() || "gpt-5.4",
    headers: parseHeaders(process.env.AX_HEADERS_JSON),
  };
}
