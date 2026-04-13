/**
 * Sentence splitter for streaming TTS.
 *
 * Buffers incoming LLM text chunks and emits complete sentences to a callback.
 * A sentence is defined as text ending in `.`, `!`, `?`, or `\n\n`.
 * Optimized for low-latency: first sentence is emitted as soon as it ends.
 *
 * Edge cases handled:
 * - Abbreviations (Mr., Dr., e.g., etc.) — not treated as sentence ends
 * - URLs (https://...) — dots inside URLs skipped
 * - Numbers (3.14, 1.5x) — decimal dots skipped
 * - Markdown headings (`## ...`) stripped before emission
 */

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs",
  "etc", "e.g", "i.e", "a.m", "p.m", "st", "ave", "blvd",
]);

// Matches markdown formatting that sounds bad when spoken
const MARKDOWN_PATTERN = /#{1,6}\s+|[*_`]+|\[([^\]]*)\]\([^)]*\)/g;

function stripMarkdown(text: string): string {
  return text
    .replace(MARKDOWN_PATTERN, (match, linkText) => linkText ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAbbreviation(textBefore: string): boolean {
  const lastWord = textBefore.split(/\s+/).pop() ?? "";
  return ABBREVIATIONS.has(lastWord.toLowerCase().replace(/\./g, ""));
}

function isInsideUrl(textBefore: string): boolean {
  const lastToken = textBefore.split(/\s+/).pop() ?? "";
  return /https?:\/\//.test(lastToken);
}

function isDecimalNumber(textBefore: string, textAfter: string): boolean {
  return /\d$/.test(textBefore) && /^\d/.test(textAfter);
}

export interface SentenceSplitterOptions {
  /** Called with each complete sentence, stripped of markdown */
  onSentence: (sentence: string) => void;
  /** Minimum sentence length to emit (prevents tiny fragments, default 8) */
  minLength?: number;
}

export class SentenceSplitter {
  private buffer = "";
  private readonly onSentence: (sentence: string) => void;
  private readonly minLength: number;

  constructor(opts: SentenceSplitterOptions) {
    this.onSentence = opts.onSentence;
    this.minLength = opts.minLength ?? 8;
  }

  /** Feed the next text chunk from the LLM stream */
  push(text: string): void {
    this.buffer += text;
    this.flush(false);
  }

  /** Flush any remaining buffered text as a final sentence */
  end(): void {
    this.flush(true);
  }

  private flush(forceAll: boolean): void {
    while (true) {
      const result = this.findSentenceEnd();
      if (result === -1) {
        if (forceAll && this.buffer.trim().length >= this.minLength) {
          this.emit(this.buffer);
          this.buffer = "";
        }
        break;
      }
      const sentence = this.buffer.slice(0, result + 1).trimStart();
      this.buffer = this.buffer.slice(result + 1);
      if (sentence.trim().length >= this.minLength) {
        this.emit(sentence);
      }
    }
  }

  private findSentenceEnd(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];

      // Double-newline paragraph break
      if (ch === "\n" && this.buffer[i + 1] === "\n") return i + 1;

      if (ch === "." || ch === "!" || ch === "?") {
        const before = this.buffer.slice(0, i);
        const after = this.buffer.slice(i + 1);

        // Must be followed by space/newline/end to be a sentence terminator
        if (after.length > 0 && !/^[\s"')]/.test(after)) continue;

        if (ch === ".") {
          if (isAbbreviation(before)) continue;
          if (isInsideUrl(before)) continue;
          if (isDecimalNumber(before, after)) continue;
        }

        return i;
      }
    }
    return -1;
  }

  private emit(raw: string): void {
    const clean = stripMarkdown(raw);
    if (clean.length >= this.minLength) {
      this.onSentence(clean);
    }
  }

  reset(): void {
    this.buffer = "";
  }
}
