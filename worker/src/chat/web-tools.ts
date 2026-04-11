/**
 * Web fetch and search helpers for cloud-mode chat.
 *
 * Regex-based HTML stripping (no jsdom) to keep the worker bundle small.
 * Fails explicitly — no silent fallbacks.
 */

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "OpenHelm-Chat/1.0 (+https://openhelm.ai)";

export interface FetchUrlResult {
  url: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/** Strip HTML to readable text, dropping script/style content. */
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

/** Fetch a URL and return its readable text content. */
export async function fetchUrlAsText(url: string, maxChars?: number): Promise<FetchUrlResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`web_fetch: only http(s) URLs are allowed (got: ${url})`);
  }
  const limit = maxChars && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`web_fetch: HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const body = await res.text();

  let text: string;
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    text = htmlToText(body);
  } else if (contentType.startsWith("text/") || contentType.includes("json")) {
    text = body.replace(/\s+/g, " ").trim();
  } else {
    throw new Error(`web_fetch: unsupported content-type "${contentType}" for ${url}`);
  }

  const truncated = text.length > limit;
  if (truncated) text = text.slice(0, limit) + "…[truncated]";

  return { url, status: res.status, contentType, text, truncated };
}

/** DuckDuckGo result hrefs are /l/?uddg=<encoded>; unwrap to the real URL. */
function extractDuckDuckGoUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const wrapped = u.searchParams.get("uddg");
    if (wrapped) return decodeURIComponent(wrapped);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

/**
 * Search the public web via DuckDuckGo's HTML endpoint (no API key required).
 * Regex-based parsing of result anchors and snippets.
 */
export async function searchWeb(query: string, maxResults?: number): Promise<WebSearchResult[]> {
  if (!query || !query.trim()) {
    throw new Error("web_search: query is required");
  }
  const limit = Math.min(maxResults && maxResults > 0 ? maxResults : DEFAULT_MAX_RESULTS, 10);

  const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(endpoint, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`web_search: HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const results: WebSearchResult[] = [];

  // DuckDuckGo HTML results: each result is a <div class="result"> containing
  // <a class="result__a" href="..."> with title and a <a class="result__snippet">
  // with the snippet text.
  const resultBlockRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\bresult\b|<\/body>|$)/gi;
  const blocks = html.match(resultBlockRegex) ?? [];

  for (const block of blocks) {
    if (results.length >= limit) break;

    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const rawHref = titleMatch[1];
    const title = htmlToText(titleMatch[2]);
    const url = extractDuckDuckGoUrl(rawHref);
    if (!title || !url) continue;

    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]) : "";

    results.push({ title, url, snippet });
  }

  if (results.length === 0) {
    throw new Error(`web_search: no results parsed for query "${query}"`);
  }
  return results;
}
