import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchUrlAsText, searchWeb } from "../src/chat/web-fetch.js";

function mockResponse(body: string, opts: { status?: number; statusText?: string; contentType?: string } = {}): Response {
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  return new Response(body, {
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers,
  });
}

describe("fetchUrlAsText", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns extracted text from an HTML page with tags stripped", async () => {
    const html = "<html><body><h1>Hello</h1><p>World <script>alert(1)</script></p></body></html>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(html, { contentType: "text/html; charset=utf-8" })));
    const result = await fetchUrlAsText("https://example.com");
    expect(result.status).toBe(200);
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World");
    expect(result.text).not.toContain("<h1>");
    expect(result.text).not.toContain("alert(1)");
    expect(result.truncated).toBe(false);
  });

  it("returns JSON body verbatim (collapsed whitespace)", async () => {
    const json = '{ "ok":\n  true }';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(json, { contentType: "application/json" })));
    const result = await fetchUrlAsText("https://api.example.com/x");
    expect(result.text).toBe('{ "ok": true }');
  });

  it("throws on non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("nope", { status: 500, statusText: "Server Error", contentType: "text/plain" })));
    await expect(fetchUrlAsText("https://example.com")).rejects.toThrow(/HTTP 500/);
  });

  it("throws on unsupported content-type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("\x00\x01binary", { contentType: "application/octet-stream" })));
    await expect(fetchUrlAsText("https://example.com/file.bin")).rejects.toThrow(/unsupported content-type/);
  });

  it("throws on non-http(s) schemes", async () => {
    await expect(fetchUrlAsText("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
    await expect(fetchUrlAsText("ftp://example.com")).rejects.toThrow(/http\(s\)/);
  });

  it("truncates output to maxChars and sets truncated flag", async () => {
    const html = `<html><body>${"a".repeat(20_000)}</body></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(html, { contentType: "text/html" })));
    const result = await fetchUrlAsText("https://example.com", 100);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(100 + "…[truncated]".length);
    expect(result.text.endsWith("…[truncated]")).toBe(true);
  });
});

describe("searchWeb", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("parses DuckDuckGo HTML results into {title, url, snippet}", async () => {
    const html = `
      <html><body>
        <div class="result">
          <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example A</a>
          <div class="result__snippet">Snippet A</div>
        </div>
        <div class="result">
          <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Example B</a>
          <div class="result__snippet">Snippet B</div>
        </div>
      </body></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(html, { contentType: "text/html" })));
    const results = await searchWeb("example query");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Example A", url: "https://example.com/a", snippet: "Snippet A" });
    expect(results[1].url).toBe("https://example.com/b");
  });

  it("respects maxResults limit", async () => {
    const item = (n: number) => `
      <div class="result">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F${n}">Title ${n}</a>
        <div class="result__snippet">Snip ${n}</div>
      </div>`;
    const html = `<html><body>${[1, 2, 3, 4, 5].map(item).join("")}</body></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(html, { contentType: "text/html" })));
    const results = await searchWeb("q", 2);
    expect(results).toHaveLength(2);
  });

  it("throws on empty query", async () => {
    await expect(searchWeb("")).rejects.toThrow(/query is required/);
  });

  it("throws when DuckDuckGo returns non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("blocked", { status: 429, statusText: "Too Many Requests", contentType: "text/html" })));
    await expect(searchWeb("q")).rejects.toThrow(/HTTP 429/);
  });

  it("throws when no results parse out of the HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("<html><body>no results</body></html>", { contentType: "text/html" })));
    await expect(searchWeb("nothing")).rejects.toThrow(/no results parsed/);
  });
});
