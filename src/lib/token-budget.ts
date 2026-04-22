import { encode } from "gpt-tokenizer";

export type OutputTokenStats = {
  tokens: number;
  chars: number;
  bytes: number;
  lines: number;
};

export function countOutputTokens(text: string) {
  return encode(text).length;
}

export function measureOutputText(text: string): OutputTokenStats {
  return {
    tokens: countOutputTokens(text),
    chars: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}
