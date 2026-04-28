export type BoundedTextResult = {
  text: string;
  truncated: boolean;
  totalChars: number;
  omittedChars: number;
  matchedNeedles: string[];
};

export type DrainBoundedTextOptions = {
  maxChars?: number;
  tailChars?: number;
  forward?: (chunk: string) => void;
  forwardMaxChars?: number;
  truncationLabel?: string;
  needles?: string[];
};

const DEFAULT_MAX_CHARS = 64_000;
const DEFAULT_TAIL_CHARS = 8_000;

export async function drainBoundedTextStream(
  stream: ReadableStream<Uint8Array>,
  options: DrainBoundedTextOptions = {},
): Promise<BoundedTextResult> {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  const tailChars = Math.min(Math.max(0, options.tailChars ?? DEFAULT_TAIL_CHARS), maxChars);
  const headChars = Math.max(0, maxChars - tailChars);
  const truncationLabel = options.truncationLabel ?? "output truncated";
  const needles = [...new Set((options.needles ?? []).filter(Boolean))];
  const matchedNeedles = new Set<string>();
  const maxNeedleChars = needles.reduce((longest, needle) => Math.max(longest, needle.length), 0);
  let needleCarry = "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let head = "";
  let tail = "";
  let totalChars = 0;
  let truncated = false;
  const forwardState = { chars: 0, truncated: false };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    observeNeedles(chunk);
    appendChunk(chunk);
    forwardChunk(chunk, options, forwardState, truncationLabel);
  }
  const finalChunk = decoder.decode();
  if (finalChunk) {
    observeNeedles(finalChunk);
    appendChunk(finalChunk);
    forwardChunk(finalChunk, options, forwardState, truncationLabel);
  }

  if (!truncated) return { text: head, truncated: false, totalChars, omittedChars: 0, matchedNeedles: [...matchedNeedles] };
  const omittedChars = Math.max(0, totalChars - head.length - tail.length);
  return {
    text: `${head}\n...[${truncationLabel}: ${omittedChars} chars omitted]...\n${tail}`,
    truncated: true,
    totalChars,
    omittedChars,
    matchedNeedles: [...matchedNeedles],
  };

  function observeNeedles(chunk: string) {
    if (!chunk || needles.length === 0) return;
    const searchable = `${needleCarry}${chunk}`;
    for (const needle of needles) {
      if (!matchedNeedles.has(needle) && searchable.includes(needle)) matchedNeedles.add(needle);
    }
    needleCarry = maxNeedleChars > 1 ? searchable.slice(-(maxNeedleChars - 1)) : "";
  }

  function appendChunk(chunk: string) {
    if (!chunk) return;
    totalChars += chunk.length;
    if (!truncated) {
      if (head.length + chunk.length <= maxChars) {
        head += chunk;
        return;
      }
      truncated = true;
      const combined = head + chunk;
      head = headChars > 0 ? combined.slice(0, headChars) : "";
      tail = tailChars > 0 ? combined.slice(-tailChars) : "";
      return;
    }
    if (tailChars > 0) tail = (tail + chunk).slice(-tailChars);
  }
}

function forwardChunk(
  chunk: string,
  options: DrainBoundedTextOptions,
  state: { chars: number; truncated: boolean },
  truncationLabel: string,
) {
  if (!options.forward || !chunk) return;
  const forwardMaxChars = Math.max(0, options.forwardMaxChars ?? options.maxChars ?? DEFAULT_MAX_CHARS);
  const remaining = forwardMaxChars - state.chars;
  if (remaining > 0) {
    const forwarded = chunk.slice(0, remaining);
    options.forward(forwarded);
    state.chars += forwarded.length;
  }
  if (!state.truncated && chunk.length > remaining) {
    options.forward(`\n...[${truncationLabel}: live output capped; command continues]...\n`);
    state.truncated = true;
  }
}
