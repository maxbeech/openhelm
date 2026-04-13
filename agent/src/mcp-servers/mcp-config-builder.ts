/**
 * Generates MCP config JSON for Claude Code's --mcp-config flag.
 *
 * Writes a per-run config file to ~/.openhelm/mcp-configs/ that tells
 * Claude Code how to start the built-in browser MCP server. The file is
 * cleaned up after the run completes.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { getBrowserMcpPaths, type BrowserMcpPaths } from "./browser-setup.js";

/**
 * Prepended to job prompts when the bundled browser MCP is available.
 */
export const BROWSER_MCP_PREAMBLE =
  "IMPORTANT: You MUST use `mcp__openhelm_browser__spawn_browser` to open any browser. " +
  "Do NOT use chrome-devtools, stealth-browser-mcp, or any other browser tool. " +
  "Close all browser instances with `mcp__openhelm_browser__close_instance` when done.\n\n" +
  "EFFICIENT BROWSING (mandatory order of operations):\n" +
  "1. After EVERY navigate/reload, your FIRST tool call MUST be `get_page_digest` — no exceptions. " +
  "It returns a compact outline (~10K tokens) of headings, links, buttons, and text. " +
  "Do NOT call `query_elements`, `find_on_page`, `find_by_role`, or `take_screenshot` before `get_page_digest`.\n" +
  "2. Read the digest to decide what to click/type. The digest shows visible labels you can pass to `find_on_page`.\n" +
  "3. Use `find_on_page(query)` (with text/selector from the digest) to locate and auto-scroll to an element — returns a selector_hint.\n" +
  "4. Use the selector_hint with `click_element`. Prefer `find_on_page` over `find_by_role` — role+name matching is fragile on SPAs.\n" +
  "5. Use `scroll_page` (returns percent, at_bottom, pages_remaining) to move through a page — NEVER screenshot to check scroll position.\n" +
  "6. Only use `take_screenshot` when you need VISUAL understanding (layout, images, CAPTCHA). Use `max_width=800, grayscale=true` to cut tokens.\n" +
  "If `get_page_digest` or `find_by_role` returns a timeout error, the page DOM is stuck — call `reload_page` once, then fall back to `take_screenshot(max_width=800, grayscale=true)`. Do NOT retry the same timing-out tool more than once.\n\n" +
  "FORM INPUT + SUBMISSION VERIFICATION (mandatory — stops false positives):\n" +
  "A. NEVER pass a comma-separated union selector (e.g. `textarea, [contenteditable], input[type=\"text\"]`) to `paste_text`/`type_text`/`click_element`. Unions routinely match the search box first. Use `find_on_page(\"Add a comment\")`, `find_on_page(\"Join the conversation\")`, or `find_on_page(\"Reply\")` and pass the returned `selector_hint`.\n" +
  "B. `paste_text` and `type_text` now return a VERIFICATION DICT — NOT a bool. After calling, you MUST check:\n" +
  "   - `verified` is true,\n" +
  "   - `inserted_chars` ≈ `expected_chars`,\n" +
  "   - `resolved_target.editor_kind` is `contenteditable` or `textarea` (not `input-search`),\n" +
  "   - `warnings` is empty.\n" +
  "   If verified is false OR warnings mention a search input OR editor_kind is `input-search`, DO NOT click submit — go back, use `find_on_page` with a more specific phrase, and retry.\n" +
  "C. After clicking any submit/post/publish/reply button, your VERY NEXT call MUST be `get_page_digest`. Confirm the editor closed, the new comment/post appears, or a success toast is visible. If none of those are true, the submission did NOT succeed — do not claim success. Retry or report the blocker.\n" +
  "D. Collapsed comment widgets (Reddit, Twitter, LinkedIn) are handled automatically: `paste_text`/`type_text` detect both hidden editors AND visible trigger wrappers (custom elements like `<faceplate-textarea-input>`, `<shreddit-composer>`), click them, wait for the real editor to mount, and auto-fall-back to a generic `textarea, [contenteditable]` scan to find the revealed editor. You do NOT need to manually switch selectors after clicking a composer trigger — just pass the same selector you used for `find_on_page` / `click_element` and paste_text will re-target. Framework-guarded editors (Lexical, ProseMirror on Reddit DM; React Fiber controlled inputs on LinkedIn) are handled by an automatic 5-step ladder (execCommand → InputEvent → ClipboardEvent → CDP insertText → keyboard Cmd/Ctrl+V → React native-setter for controlled inputs). The verification dict's `method_used` field names which technique actually landed — `execCommand` (fastest, works on most pages), `input_event` / `clipboard_event` (Lexical/ProseMirror), `react_native_setter` (LinkedIn message composer and other React-controlled inputs), `cdp_insert_text` / `keyboard_paste` (last-resort fallbacks). If paste_text still returns `verified: false` after auto-expand, check `resolved_target.fallback_editor_used` and `activator_clicked` — if both are true and it STILL failed, the composer wants a real mouse gesture: call `click_element` on the activator selector, then `get_page_digest`, then retry. Do NOT give up after a single failed paste_text — retry at least twice with different approaches before abandoning the thread.\n" +
  "E. `find_on_page(query)` is the most reliable way to locate a specific piece of UI. It accepts plain text (case-insensitive), CSS selectors, and XPath (starting with `//`), and always returns a `selector_hint` of the form `[data-oh-find=\"1\"]` or similar that you can pass directly to `click_element`/`paste_text`. Note: on Reddit, find_on_page for 'Join the conversation' returns a selector for the trigger WRAPPER, not the editor itself — but paste_text handles this automatically (see rule D). Use the same selector_hint for both `click_element` and the subsequent `paste_text`.\n" +
  "E3. `triple_click(instance_id, selector)` selects the full line / paragraph under an element via three rapid synthesised mouse events (clickCount 1→2→3). Use it when you need to highlight existing text in an input before typing over it (triple-click selects everything in an `<input>`, the whole paragraph in a contenteditable). Pair with `type_text` / `paste_text` — those already auto-clear when `clear_first=true`, so triple_click is only needed when you want the browser's native selection-replace behaviour (e.g. when a framework fights your clear).\n" +
  "E2. Shadow DOM inputs (old reddit login, custom web-component auth forms, some legacy CMS logins) are now reachable automatically — the resolver walks open shadow roots and `paste_text`/`type_text`/`find_on_page` see shadow-hosted elements as if they were in the flat DOM. If you spot `is_shadow_hosted: true` in the `resolved_target`, no special handling is needed — just paste as normal.\n\n" +
  "PLATFORM ANTI-AUTOMATION BLOCKERS (mandatory — do not waste turns):\n" +
  "F. Reddit signup-modal overlay: When browsing a Reddit thread without a valid logged-in session, Reddit injects a full-screen 'Sign up' modal over the comment form. If `get_page_digest` shows 'Sign up' / 'Continue with Google' prominently near the comment area, OR if `paste_text` returns `verified: false` on a Reddit comment target more than once, the session is NOT valid — STOP trying to paste. Do one of: (a) call `check_session(instance_id, \"reddit.com\")` — if `logged_in: false`, call `request_user_help` with reason `\"Reddit session expired — please log in manually\"` and poll. (b) If `request_user_help` is not appropriate for this job, STOP and report `blocker: \"reddit_session_expired\"` as the final status. Do NOT attempt to submit comments via execute_script, clipboard hacks, or DOM manipulation — Reddit's reCAPTCHA on comment submission will block those too.\n" +
  "G. LinkedIn message composer: The 5-step paste ladder (rule D) auto-handles React-controlled inputs via the native-setter trick. On `paste_text`, look for `method_used: \"react_native_setter\"` in the result — that's the expected method when targeting LinkedIn. If `paste_text` returns `verified: false` on a LinkedIn message target after 2 attempts (one with `find_on_page(\"Write a message\")`, one with `find_on_page(\"Message\")`), fall through to `type_text` with `humanize=false, delay_ms=15` — it will run the same ladder including the react_native_setter path. If that ALSO fails, STOP and report `blocker: \"linkedin_message_composer\"`. Do not pivot to a different contact.\n" +
  "H. LinkedIn connection-modal button: The 'Send without a note' button on LinkedIn's connection modal sometimes swallows programmatic clicks. If `click_element` on that button returns success but the modal is still visible on the next `get_page_digest`, retry ONCE using `find_on_page(\"Send without a note\")` to get a fresh selector. If still blocked, STOP and report `blocker: \"linkedin_connection_modal\"`. Do NOT call `execute_script` to simulate the click — LinkedIn filters synthetic MouseEvents on this control.\n" +
  "I. GENERAL RULE: any time a platform is actively blocking automation (reCAPTCHA on submit, overlaid modal, editor ignoring input), after AT MOST 2 structured retries you MUST STOP and report the specific blocker as the run's final status. Burning 20+ turns on a blocked platform is worse than a clean refusal — the user will see both the attempt and the reason in the run log.\n\n";

/**
 * Injected as a system-level instruction via --append-system-prompt when the
 * bundled browser MCP is available. System prompts are far more authoritative
 * than user-prompt preambles and virtually guarantee Claude uses the right MCP.
 */
export const BROWSER_SYSTEM_PROMPT =
  "BROWSER AUTOMATION RULE (mandatory, no exceptions): " +
  "The ONLY browser tool you may call is `mcp__openhelm_browser__spawn_browser` and the other `mcp__openhelm_browser__*` tools. " +
  "You MUST NOT call any tool from chrome-devtools, stealth-browser-mcp, or any MCP server other than openhelm_browser for browser automation. " +
  "If openhelm_browser tools are unavailable or return an error, stop and report the error — do NOT fall back to another browser MCP. " +
  "Always call `mcp__openhelm_browser__close_instance` for every browser instance you open before finishing. " +
  "BROWSER INSTANCE IDs: an `instance_id` returned by `spawn_browser` is a UUID like `c252d8da-b78c-42df-8b1f-fbd4341bee7c` — NEVER pass human-readable labels (`\"hn-session\"`, `\"browser_1\"`, `\"main\"`) as an instance_id. If a tool returns `Instance not found: <id>`, the error message now includes the list of live UUIDs — retry with one of those, or call `list_instances` if the list is empty.";

/**
 * Injected as a system-level instruction on every run. Codifies known quirks
 * of external MCP servers (Notion, etc.) so Claude doesn't waste tool calls
 * rediscovering them after every context compaction.
 */
export const EXTERNAL_MCP_GUIDANCE =
  "EXTERNAL MCP TOOL QUIRKS (mandatory, no exceptions):\n" +
  "- Notion MCP tools use HYPHENS, not underscores. The correct names are " +
  "`mcp__notion__notion-fetch`, `mcp__notion__notion-search`, " +
  "`mcp__notion__notion-update-page`, etc. `mcp__notion__notion_fetch` " +
  "(underscore) does NOT exist — do not call it.\n" +
  "- `mcp__notion__notion-fetch` does NOT support Notion view URLs. If a URL " +
  "contains a `?v=<viewId>` query parameter (or any `&v=...`), STRIP the " +
  "`v` parameter before calling the tool — pass only the database/page URL. " +
  "Example: `https://notion.so/workspace/DB-abc123?v=xyz` → fetch " +
  "`https://notion.so/workspace/DB-abc123`. The tool returns a 400 " +
  "validation error (`URL type view not currently supported`) if you " +
  "leave the view param in, and falling back to the browser to read " +
  "Notion is slow and error-prone — do not do that when a simple URL " +
  "strip would work.\n" +
  "- `mcp__notion__notion-search` `page_size` parameter MUST be ≤25. Notion " +
  "enforces this server-side and rejects larger values with `MCP error " +
  "-32602: Invalid arguments for tool notion-search: page_size must be ≤25, " +
  "expected 25`. Always pass `page_size: 25` (or less) and paginate with " +
  "the cursor if more results are needed. Do NOT pass `page_size: 100` " +
  "or any value >25 — it will always fail.\n" +
  "- `mcp__Sentry__search_issues` and `mcp__Sentry__search_events` do NOT " +
  "support boolean `OR` / `AND` operators inside the query string. Split " +
  "multi-clause queries into multiple separate calls and merge the results " +
  "client-side. A query like `\"error\" OR \"warning\"` returns HTTP 400 " +
  "with `Error parsing search query: Boolean statements containing \"OR\" " +
  "or \"AND\" are not supported`. Do NOT use `sentry-cli issues list --first` " +
  "either — `--first` is not a valid flag for that subcommand.";

/**
 * Prepended to job prompts to instruct Claude on CAPTCHA handling.
 * Covers detection, auto-solve attempts, alternative reasoning, and
 * user intervention request with polling loop.
 */
export const BROWSER_CAPTCHA_PREAMBLE =
  "CAPTCHA HANDLING (mandatory):\n" +
  "- navigate(), go_back(), go_forward(), and reload_page() automatically detect CAPTCHAs. " +
  "If the response contains captcha_detected=true, you MUST immediately call " +
  "request_user_help with the reason from captcha_action_required. Do NOT close the browser.\n" +
  "- CLOUDFLARE INTERACTIVE CHALLENGES (X.com, Quora, Discord upstream — these are the ones " +
  "that have been blocking scheduled runs). Landing on `x.com/account/access`, a 'Just a moment...' " +
  "interstitial that persists past `reload_page`, any page whose body contains 'Verify you are human' / " +
  "'Performing security verification' / 'Checking your browser', or a shadow-DOM Turnstile checkbox " +
  "you can't find via get_page_digest — ALL of these require `request_user_help` as your FIRST " +
  "action, not your last. Round 11 stealth patches (force-open shadow DOM, Sec-CH-UA alignment) " +
  "reduce but DO NOT eliminate interactive Turnstile — the behavioural ML scoring it runs after " +
  "the checkbox click is still beyond any JS patch. Your escalation order on these platforms is:\n" +
  "  1. `request_user_help(reason=\"cloudflare_interactive\")` — FIRST, not fifth. A visible Chrome " +
  "window opens; the user clicks the checkbox manually; you resume.\n" +
  "  2. Poll `take_screenshot` every 30s for up to 15 minutes.\n" +
  "  3. Only if the 15-minute budget expires, stop and report `blocked on Cloudflare`. \n" +
  "  DO NOT: try `click_element` on an invisible shadow-DOM checkbox, retry navigate() in a loop, " +
  "or pivot to a different platform. Abandoning a Cloudflare-blocked run after 30 seconds without " +
  "calling `request_user_help` is a job failure you are responsible for, NOT a platform limitation. " +
  "If your job explicitly targets X.com, Quora, or Discord, plan for `request_user_help` as part of " +
  "the normal flow on those platforms — not as an exception.\n" +
  "- After calling request_user_help, poll with take_screenshot every 30s for up to 15 minutes. " +
  "Output a status line each poll to prevent silence timeout. Do NOT give up after 30 seconds, " +
  "1 minute, or 5 minutes — the user may be away from their machine and needs time to notice " +
  "the notification. The 15-minute budget is the MINIMUM wait; only stop earlier if take_screenshot " +
  "shows the CAPTCHA is resolved.\n" +
  "- If a page looks wrong, empty, or shows 'Just a moment...', check the response for captcha_detected " +
  "before giving up.\n" +
  "- NEVER close a browser instance that has an unresolved CAPTCHA.\n" +
  "- NEVER pivot to a different target platform after a CAPTCHA timeout. If this job was about " +
  "X.com engagement and X.com is blocked, the correct outcome is to STOP and report " +
  "\"blocked on X.com CAPTCHA\" — do NOT post to Hacker News, Reddit, LinkedIn, or any other " +
  "platform as a substitute. Posting to the wrong platform wastes the entire run and still " +
  "fails the job's mission. The only exception is when the job prompt EXPLICITLY lists " +
  "multiple target platforms as interchangeable alternatives.\n\n";

/**
 * Prepended to job prompts to instruct Claude on persistent profile usage
 * and authenticated session handling.
 */
export const BROWSER_PROFILE_PREAMBLE =
  "PERSISTENT BROWSER PROFILES (mandatory):\n" +
  "- `spawn_browser` takes `profile=\"<name>\"` to reuse a persistent Chrome profile (cookies, localStorage, logged-in sessions). It does NOT take `instance_id`, `name`, `session_name`, or `id` — the returned instance_id is auto-generated.\n" +
  "- If a credential is listed below with a profile name, you MUST use that exact profile name on spawn. Do NOT invent a new profile name for that site.\n" +
  "- If no credential-linked profile exists for the target site, omit `profile` entirely (or explicitly pass `profile=\"default\"`) — the tool defaults to the shared `default` profile. This keeps cookies between runs and is what bypasses Reddit/Cloudflare fresh-browser bot checks.\n" +
  "- DO NOT invent per-task profile names like `\"search_session\"`, `\"hn_browser\"`, `\"reddit_task\"`. Those create brand-new empty profiles every run, which is equivalent to having no profile at all. Reuse existing named profiles or fall back to `default`.\n" +
  "- After spawning, call `check_session(instance_id, domain)` on any site that needs login. If the session is expired, call `auto_login` with the credential name. If auto_login also fails, call `request_user_help` for manual login.\n" +
  "- If the first `navigate` lands on an anti-bot page ('Prove your humanity', 'Just a moment', 'Checking your browser'), DO NOT immediately close the instance and move on. Try: (1) wait 3s and `reload_page` once, (2) if still blocked, re-spawn with the site's dedicated profile (e.g. `profile=\"reddit\"`, `profile=\"xcom\"`) — existing cookies often bypass the check, (3) only call `request_user_help` or abandon the platform if both fail. Do NOT skip a whole target platform after a single flake.\n" +
  "- CROSS-COMPACTION RECOVERY (critical): if your context has just been compacted (you see a conversation summary at the top and don't remember what you were doing), the Python browser MCP subprocess is still running with your PREVIOUS browser instance and all its cookies/auth still live. BEFORE calling `spawn_browser`, call `list_instances` to see what's already attached. If an instance exists, use its `instance_id` directly — do NOT spawn a fresh browser, as that will force a full re-login and lose whatever work you were in the middle of (CAPTCHA, auth, session state). If you do call `spawn_browser(profile=\"<name>\")` and a live instance is already bound to that profile, the tool will transparently return the existing instance (`reused: true` in the response) — accept that and continue; do NOT treat it as an error.\n" +
  "- NEVER trust a browser `instance_id` UUID that appears in a conversation summary at the top of your compacted context — that UUID may be from a browser instance that was already cleaned up by the idle reaper (5-minute inactivity timeout). After compaction, your FIRST browser-related call MUST be `list_instances` to get the CURRENT live UUID set. If the UUID from your summary is NOT in the live set, discard it from your working memory entirely — subsequent `get_page_digest`, `navigate`, etc. calls on that stale UUID will return `Instance not found: <id>` and waste turns. If the live set is empty, then (and only then) spawn a fresh browser.\n\n";

/**
 * Prepended to job prompts when the browser MCP is available and the job may
 * post content on social media platforms. Enforces authentic, non-promotional
 * engagement so that automated posts are genuinely helpful rather than spammy.
 */
export const SOCIAL_MEDIA_ENGAGEMENT_PREAMBLE =
  "SOCIAL MEDIA ENGAGEMENT ETHICS (mandatory, no exceptions):\n" +
  "When posting comments, replies, or messages on any social media platform " +
  "(Reddit, X/Twitter, Hacker News, LinkedIn, Discord, or any other platform), " +
  "you MUST follow these rules:\n" +
  "1. BE GENUINELY HELPFUL: Every post must add real value to the conversation. " +
  "Engage with the actual content of the thread — answer questions, share relevant " +
  "experience, offer concrete advice, or contribute a meaningful perspective.\n" +
  "2. NEVER SOUND PROMOTIONAL OR SPAMMY: Do not use marketing language, superlatives, " +
  "or calls-to-action. Do not open with praise for the thread just to appear engaged. " +
  "Do not pad comments with filler phrases like 'Great question!' or 'I came across this " +
  "and thought I'd share...'.\n" +
  "3. ONLY MENTION THE PRODUCT WHEN IT IS DIRECTLY RELEVANT: Only reference the product " +
  "or tool being built if it genuinely solves the specific problem or need being discussed " +
  "in that thread. If a mention is warranted, be brief, factual, and specific about why " +
  "it applies. Never shoehorn in a mention when the thread is not directly about a problem " +
  "the product addresses.\n" +
  "4. BE TRANSPARENT ABOUT AFFILIATION: If you mention the product, you must disclose " +
  "your connection to it (e.g. 'I'm building something similar' or 'Disclosure: I work " +
  "on this tool'). Never hide the fact that you are associated with what you are referencing.\n" +
  "5. DO NOT DUPLICATE OR MASS-POST: Do not post the same comment or a near-identical " +
  "comment across multiple threads or platforms. Each post must be unique and tailored " +
  "to its specific context.\n" +
  "6. WHEN IN DOUBT, SAY NOTHING: If you cannot add genuine value without mentioning the " +
  "product, skip the post entirely and report that no suitable opportunity was found. " +
  "A skipped post is always better than a spammy or misleading one.\n\n";

/**
 * Prepended to job prompts when the data tables MCP is available.
 */
export const DATA_TABLES_MCP_PREAMBLE =
  "Data tables are available via openhelm_data MCP tools. Check existing tables before creating new ones.\n\n";

/**
 * Injected as a system-level instruction on EVERY run via --append-system-prompt.
 * Prevents Claude from asking clarifying questions instead of executing.
 *
 * Claude Code in --print mode sometimes summarises the task and asks
 * "Should I start?" or "Would you like me to...?" before doing any work.
 * This instruction eliminates that behaviour.
 */
export const EXECUTION_SYSTEM_PROMPT =
  "EXECUTION MODE (mandatory, no exceptions): " +
  "You are running in fully automated, non-interactive mode inside OpenHelm. " +
  "Execute every step in the task immediately, starting from step 1. " +
  "Do NOT ask the user for confirmation, approval, or clarification. " +
  "Do NOT summarise the task back and ask 'Should I start?', 'Would you like me to...', " +
  "'Shall I proceed?', or any similar question — just start executing. " +
  "If something is ambiguous, make a reasonable choice and proceed. " +
  "Only stop if you hit a genuine, unrecoverable blocker (e.g. missing credentials, " +
  "inaccessible resource) — in that case, report the specific blocker and stop. " +
  "There is no human watching this session, so questions will never be answered.";

/**
 * Produce an explicit browser-credentials notice for the job prompt based on
 * which credentials are actually bound to this run. This prevents Claude from
 * hallucinating credential names and blindly calling auto_login when nothing
 * is actually loaded (which wastes turns and tokens).
 *
 * Each credential may have an associated persistent browser profile. When
 * present, Claude should spawn_browser with that profile to reuse saved
 * cookies/sessions — auto_login is only needed if the session has expired.
 */
export function buildBrowserCredentialsNotice(
  credentials: Array<{ name: string; type: "username_password" | "token"; profileName?: string }>,
): string {
  if (credentials.length === 0) {
    return (
      "BROWSER CREDENTIALS: No credentials are bound to this project/job. " +
      "`list_browser_credentials` will return an empty array, and `auto_login` " +
      "WILL fail. Do NOT guess credential names. " +
      "If the task requires a logged-in session, call `spawn_browser` WITHOUT a " +
      "`profile` kwarg (or explicitly pass `spawn_browser(profile=\"default\")`) — " +
      "the tool defaults to the shared `default` profile, which preserves any cookies/sessions from previous " +
      "runs. If that session is expired, call `request_user_help` so the user can log " +
      "in manually in the visible window, then poll for completion. Do not attempt to " +
      "create an account.\n\n"
    );
  }
  const lines = credentials.map((c) => {
    const profileHint = c.profileName
      ? ` → spawn_browser(profile="${c.profileName}") for pre-authenticated session`
      : "";
    return `  - "${c.name}" (${c.type})${profileHint}`;
  }).join("\n");
  return (
    "BROWSER CREDENTIALS (pre-loaded for this run — use the exact names below):\n" +
    lines +
    "\n\nWORKFLOW: For each site, first `spawn_browser` with the credential's profile " +
    "(listed above) to reuse the saved session. Call `check_session` to verify. " +
    "Only if the session is expired, fall back to `auto_login` with the credential name. " +
    "If auto_login also fails, call `request_user_help` for manual login.\n\n" +
    "NO EXTERNAL API/OAUTH CONFIG FILES (mandatory): Authentication for every site " +
    "above is handled ENTIRELY by the browser credential + its linked profile. " +
    "Do NOT search for, read, require, or ask the user to create any external API " +
    "or OAuth config file — e.g. `~/.openhelm/reddit-config.json`, `reddit-cookies.json`, " +
    "`twitter-api.json`, `linkedin-oauth.json`, or any `*-config.json` / `*-credentials.json` " +
    "under `~/.openhelm/`. Those files do NOT exist and are NOT needed. " +
    "Do NOT use PRAW, Reddit Script Apps, Tweepy, the LinkedIn API, or any other " +
    "API client library — the ONLY supported path is the browser MCP with the " +
    "credential + profile above. If a job prompt references an API/OAuth/Script-App " +
    "workflow for one of these sites, treat that as out-of-date and use the browser " +
    "flow instead. If you genuinely cannot log in via the browser after `auto_login` " +
    "and `request_user_help` have both failed, stop and report the specific blocker — " +
    "do NOT invent an API-based fallback.\n\n"
  );
}

const MCP_CONFIG_DIR = join(
  process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
  "mcp-configs",
);

export interface McpServerEntry {
  command: string;
  args: string[];
  cwd?: string;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * Resolve the path to the data-tables MCP server bundle.
 * In development: dist/mcp-data-tables.js (built by esbuild).
 * In production: alongside the agent binary in Contents/MacOS/.
 */
function getDataTablesMcpPath(): string | null {
  const candidates = [
    join(__dirname, "mcp-data-tables.js"),                // production (same dir as agent)
    join(__dirname, "..", "dist", "mcp-data-tables.js"),  // dev (from src/)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  console.error("[mcp-config] WARNING: mcp-data-tables.js not found in any candidate path");
  return null;
}

/**
 * Get the SQLite database path used by the agent.
 */
function getDbPath(): string {
  return join(
    process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
    "openhelm.db",
  );
}

/**
 * Build the MCP config object for a run.
 *
 * Contains only the bundled OpenHelm MCP servers (browser + data tables).
 * Passed via --mcp-config to ADD these servers on top of the user's existing
 * global (~/.claude.json) and project-level (.mcp.json) servers — Claude Code
 * merges them automatically. No --strict-mcp-config is used, so the user's
 * full MCP environment is preserved.
 *
 * Returns null if no bundled servers are available.
 *
 * @param runId — OpenHelm run ID, passed as `--run-id` for intervention context.
 * @param credentialsFilePath — path to a temp JSON file containing browser-injectable credentials.
 * @param projectId — project ID, passed to the data tables MCP server.
 */
export function buildMcpConfig(runId: string, credentialsFilePath?: string, projectId?: string): McpConfigFile | null {
  const servers: Record<string, McpServerEntry> = {};

  // Bundled openhelm_browser (when venv is ready)
  const browserPaths = getBrowserMcpPaths();
  if (browserPaths) {
    // Validate all referenced paths exist before including in config.
    // A bad path here means the MCP server will fail to start, causing
    // "No such tool available" errors that waste the entire run.
    const pathsOk =
      existsSync(browserPaths.pythonPath) &&
      existsSync(browserPaths.serverModule) &&
      existsSync(browserPaths.cwd);
    if (!pathsOk) {
      console.error(
        "[mcp-config] browser MCP paths invalid — skipping:",
        JSON.stringify({
          python: existsSync(browserPaths.pythonPath),
          server: existsSync(browserPaths.serverModule),
          cwd: existsSync(browserPaths.cwd),
        }),
      );
    } else {
      const args = [
        browserPaths.serverModule,
        "--transport", "stdio",
        "--run-id", runId,
        "--disable-progressive-cloning",
        "--disable-file-extraction",
        "--disable-element-extraction",
        "--disable-dynamic-hooks",
        "--disable-debugging",
        "--disable-cdp-functions",
        "--block-resources-default", "font,media",
      ];
      if (credentialsFilePath) {
        args.push("--credentials-file", credentialsFilePath);
      }
      servers["openhelm_browser"] = {
        command: browserPaths.pythonPath,
        args,
        cwd: browserPaths.cwd,
      };
    }
  }

  // Bundled openhelm_data (data tables MCP)
  const dataTablesMcpPath = getDataTablesMcpPath();
  if (dataTablesMcpPath) {
    const dtArgs = [dataTablesMcpPath, "--db-path", getDbPath(), "--run-id", runId];
    if (projectId) {
      dtArgs.push("--project-id", projectId);
    }
    servers["openhelm_data"] = {
      command: process.execPath,
      args: dtArgs,
    };
  }

  if (Object.keys(servers).length === 0) return null;
  return { mcpServers: servers };
}

/**
 * Write the MCP config to a file and return the path + the list of
 * server names actually written. Returns null if no bundled MCP servers
 * are available.
 *
 * Round 10 (2026-04-12): now returns `{path, serverNames}` instead of
 * just `path`. Executor uses `serverNames` to filter phantom MCP server
 * names in the tool-missing detector (Pattern 14). Callers that only
 * need the path should read the `.path` property.
 *
 * @param credentialsFilePath — forwarded to buildMcpConfig for browser credential injection.
 * @param projectId — forwarded to buildMcpConfig for data tables MCP server.
 */
export interface McpConfigFileInfo {
  path: string;
  serverNames: string[];
}

export function writeMcpConfigFile(
  runId: string,
  credentialsFilePath?: string,
  projectId?: string,
): McpConfigFileInfo | null {
  const config = buildMcpConfig(runId, credentialsFilePath, projectId);
  if (!config) return null;

  mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  const configPath = join(MCP_CONFIG_DIR, `run-${runId}.json`);
  const jsonStr = JSON.stringify(config, null, 2);
  // Write with 0600 permissions — the file contains the credentials file path,
  // so limit visibility to the current user only.
  writeFileSync(configPath, jsonStr, { mode: 0o600 });

  // Post-write validation: verify the file was actually written and is readable.
  // This catches race conditions where cleanup deletes the file between write and
  // Claude Code reading it.
  if (!existsSync(configPath)) {
    console.error(`[mcp-config] CRITICAL: config file not found after write: ${configPath}`);
    // Retry write once
    writeFileSync(configPath, jsonStr, { mode: 0o600 });
    if (!existsSync(configPath)) {
      console.error("[mcp-config] retry also failed — MCP servers will be unavailable");
      return null;
    }
  }

  // Verify content is valid JSON and contains expected servers
  const serverNames = Object.keys(config.mcpServers ?? {});
  try {
    const readBack = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(readBack);
    const diskNames = Object.keys(parsed.mcpServers ?? {});
    console.error(`[mcp-config] verified config for run ${runId}: ${diskNames.join(", ")}`);
  } catch (err) {
    console.error(`[mcp-config] WARNING: config file validation failed: ${err}`);
  }

  return { path: configPath, serverNames };
}

/** Remove a previously written MCP config file (post-run cleanup). */
export function removeMcpConfigFile(configPath: string): void {
  try {
    unlinkSync(configPath);
  } catch {
    // File already removed or doesn't exist — ignore
  }
}

/**
 * Sweep orphaned config files from ~/.openhelm/mcp-configs/.
 * Called at agent startup to clean up after crashes.
 *
 * Only deletes files older than 5 minutes to avoid a race condition where
 * a config written for a new run gets deleted before Claude Code reads it.
 */
export function cleanupOrphanedConfigs(): void {
  const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  let cleaned = 0;

  try {
    const files = readdirSync(MCP_CONFIG_DIR);
    for (const file of files) {
      if (file.startsWith("run-") && file.endsWith(".json")) {
        const filePath = join(MCP_CONFIG_DIR, file);
        try {
          const stat = statSync(filePath);
          const age = now - stat.mtimeMs;
          if (age > MAX_AGE_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // File already gone or can't be stat'd — ignore
        }
      }
    }
    if (cleaned > 0) {
      console.error(`[mcp-config] cleaned up ${cleaned} orphaned config file(s)`);
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}
