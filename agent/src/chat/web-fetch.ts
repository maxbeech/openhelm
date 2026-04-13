/**
 * Web fetch and search helpers used by the read-only chat tool set.
 *
 * Both helpers hit the network directly from the agent process and return
 * plain-text content. HTML parsing uses jsdom (already a dependency).
 * Fails explicitly on any error — no silent fallbacks.
 */

import { JSDOM } from "jsdom";

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_MAX_RESULTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "OpenHelm-Chat/1.0 (+https://openhelm.app)";

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

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip HTML to readable text, dropping script/style content. */
function htmlToText(html: string): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  doc.querySelectorAll("script, style, noscript").forEach((el: Element) => el.remove());
  const body = doc.body?.textContent ?? "";
  return collapseWhitespace(body);
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
    text = collapseWhitespace(body);
  } else {
    throw new Error(`web_fetch: unsupported content-type "${contentType}" for ${url}`);
  }

  const truncated = text.length > limit;
  if (truncated) text = text.slice(0, limit) + "…[truncated]";

  return { url, status: res.status, contentType, text, truncated };
}

/**
 * Search the public web via DuckDuckGo's HTML endpoint (no API key required).
 * Returns the top results as { title, url, snippet } objects.
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
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const results: WebSearchResult[] = [];
  const resultNodes = doc.querySelectorAll("div.result, div.web-result");
  for (const node of Array.from(resultNodes) as Element[]) {
    if (results.length >= limit) break;
    const titleEl = node.querySelector("a.result__a, a.result__url");
    const snippetEl = node.querySelector(".result__snippet");
    const title = collapseWhitespace(titleEl?.textContent ?? "");
    const rawHref = titleEl?.getAttribute("href") ?? "";
    const snippet = collapseWhitespace(snippetEl?.textContent ?? "");
    if (!title || !rawHref) continue;

    // DuckDuckGo wraps result URLs in a redirect: /l/?uddg=<encoded-url>
    const url = extractDuckDuckGoUrl(rawHref);
    if (!url) continue;

    results.push({ title, url, snippet });
  }

  if (results.length === 0) {
    throw new Error(`web_search: no results parsed for query "${query}"`);
  }
  return results;
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
