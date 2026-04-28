import { describe, expect, test } from "bun:test";
import { drainBoundedTextStream } from "../src/lib/bounded-output";

describe("bounded output capture", () => {
  test("keeps command output bounded while preserving head and tail", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("head\n"));
        controller.enqueue(new TextEncoder().encode("middle\n".repeat(30)));
        controller.enqueue(new TextEncoder().encode("tail\n"));
        controller.close();
      },
    });

    const result = await drainBoundedTextStream(stream, {
      maxChars: 60,
      tailChars: 20,
      truncationLabel: "test output truncated",
    });

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(140);
    expect(result.text).toContain("head");
    expect(result.text).toContain("tail");
    expect(result.text).toContain("test output truncated");
    expect(result.omittedChars).toBeGreaterThan(0);
  });

  test("caps live forwarding without stopping stream consumption", async () => {
    let forwarded = "";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234567890"));
        controller.enqueue(new TextEncoder().encode("abcdefghij"));
        controller.close();
      },
    });

    const result = await drainBoundedTextStream(stream, {
      maxChars: 40,
      forwardMaxChars: 12,
      forward: (chunk) => { forwarded += chunk; },
      truncationLabel: "live truncated",
    });

    expect(result.text).toBe("1234567890abcdefghij");
    expect(forwarded).toContain("1234567890ab");
    expect(forwarded).toContain("live truncated");
    expect(forwarded).not.toContain("cdefghij");
  });
});
