import { describe, it, expect, vi } from "vitest";
import { SentenceSplitter } from "../src/voice/sentence-splitter.js";

function collect(chunks: string[]): string[] {
  const sentences: string[] = [];
  const splitter = new SentenceSplitter({ onSentence: (s) => sentences.push(s) });
  for (const chunk of chunks) splitter.push(chunk);
  splitter.end();
  return sentences;
}

describe("SentenceSplitter", () => {
  it("emits a simple sentence ending with period", () => {
    const out = collect(["Hello world."]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("Hello world.");
  });

  it("emits multiple sentences from a single chunk", () => {
    // "Third?" is 6 chars < minLength=8, so only 2 pass the filter
    const out = collect(["First sentence. Second sentence! Third?"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("First sentence.");
    expect(out[1]).toBe("Second sentence!");
  });

  it("handles sentences split across multiple chunks", () => {
    const out = collect(["Hello wor", "ld. Good", "bye."]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("Hello world.");
    expect(out[1]).toBe("Goodbye.");
  });

  it("does not split on abbreviations like Dr. or Mr.", () => {
    const out = collect(["Dr. Smith arrived. He sat down."]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("Dr. Smith arrived.");
    expect(out[1]).toBe("He sat down.");
  });

  it("does not split on decimal numbers", () => {
    const out = collect(["Version 3.14 is the latest. Install it now."]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("3.14");
  });

  it("splits on double newline paragraph break", () => {
    const out = collect(["First paragraph.\n\nSecond paragraph."]);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("strips markdown headers", () => {
    const out = collect(["## Hello World. This is a test."]);
    expect(out[0]).not.toContain("##");
    expect(out[0]).toContain("Hello World");
  });

  it("strips bold markdown", () => {
    const out = collect(["This is **bold** text. Done."]);
    expect(out[0]).not.toContain("**");
    expect(out[0]).toContain("bold");
  });

  it("strips markdown links", () => {
    const out = collect(["Click [here](https://example.com) to proceed. Done."]);
    expect(out[0]).toContain("here");
    expect(out[0]).not.toContain("https://example.com");
  });

  it("flushes remaining text on end() even without terminator", () => {
    const sentences: string[] = [];
    const splitter = new SentenceSplitter({ onSentence: (s) => sentences.push(s) });
    splitter.push("This has no terminator");
    splitter.end();
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toBe("This has no terminator");
  });

  it("respects minimum length — doesn't emit very short fragments", () => {
    const out = collect(["Hi. This is a longer sentence."]);
    // "Hi." is < 8 chars, should be skipped
    expect(out.every((s) => s.length >= 8)).toBe(true);
  });

  it("handles exclamation and question marks", () => {
    // Short fragments like "Wow!" and "Really?" are filtered by minLength (< 8 chars)
    // Only "Yes indeed." (11 chars) passes the filter
    const out = collect(["Wow! Really? Yes indeed."]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("Yes indeed.");
  });

  it("handles URLs without splitting on dots", () => {
    // "Thanks." is 7 chars (< 8 minLength), so only the first sentence is emitted
    const out = collect(["Visit https://openhelm.dev for details. Thanks."]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("openhelm.dev");
    expect(out[0]).toContain("details");
  });

  it("calls onSentence with each sentence callback", () => {
    const cb = vi.fn();
    const splitter = new SentenceSplitter({ onSentence: cb });
    // Use sentences that exceed the 8-char minLength
    splitter.push("First sentence here. Second sentence here. Third sentence here.");
    splitter.end();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("reset() clears buffered state", () => {
    const sentences: string[] = [];
    const splitter = new SentenceSplitter({ onSentence: (s) => sentences.push(s) });
    splitter.push("Incomplete");
    splitter.reset();
    splitter.push("Fresh start. Done.");
    splitter.end();
    // Should only have the post-reset sentences
    expect(sentences[0]).toBe("Fresh start.");
  });
});
