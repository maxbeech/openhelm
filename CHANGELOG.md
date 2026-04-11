# Changelog

## [Unreleased]

### Fixed
- **Executor profile lock deadlock**: Fixed critical bug where `cancelRun()` and `stopAll()` failed to release profile locks when aborting runs, causing permanent deadlock on profile-dependent concurrent runs.
- **Run state inconsistency**: Fixed missing run status update and IPC event emission in `cancelRun()` when aborting active runs. Cancelled active runs now properly transition to "cancelled" status and notify the UI.
- **Power management cleanup**: Fixed `stopAll()` not calling `onRunFinished()` when power management is enabled, causing the app to stay awake after all runs were stopped.

### Added
- **Token-efficient page understanding (`get_page_digest`)**: New tool uses CDP Accessibility tree to produce a compact semantic digest of any web page at ~5-15K tokens (vs 188K+ for raw HTML or 25K per screenshot). Returns an annotated outline with headings, links, buttons, form fields, and their states. Supports lazy-load triggering and configurable token budget.
- **DOM search & scroll (`find_on_page`)**: Search the page for text, CSS selectors, or XPath using CDP `DOM.performSearch`. Auto-scrolls to the match and returns a `selector_hint` for use with `click_element`. Eliminates screenshot-scroll-screenshot cycles for locating elements.
- **Role-based element search (`find_by_role`)**: Find elements by accessible role and name using CDP `Accessibility.queryAXTree` (e.g., find button named "Submit"). Auto-scrolls to match.
- **Smart scroll metrics**: `scroll_page` now returns position metrics (percent scrolled, at_top/at_bottom, pages_remaining, content_grew) so the AI agent knows where it is on the page. Supports percent-based scrolling and `wait_for_content` for lazy-loaded pages.
- **Screenshot optimization**: New `grayscale`, `max_width`, `quality`, and `region` parameters on `take_screenshot`. Region screenshots capture only a specific area (useful after `find_on_page`). Grayscale reduces size ~30-40% for text-heavy pages.

### Fixed
- **"Profile 'default' is already in use" stalls every subsequent spawn (Run c2225fd1)**: A LinkedIn outreach run failed after two successful prospect touches because `spawn_browser` hit "Profile 'default' is already in use by another task" on every retry and then "Failed to connect to browser — one of the causes could be when you are running as root" on further attempts. Root cause was an orphaned profile lock + leftover Chrome Singleton files, both introduced by Round 7's default-profile fallback: (1) `browser_manager.cleanup_inactive()` (the 5-minute idle reaper, which fires during Claude Code's long context-compaction pauses) closes browser instances directly via `browser_manager.close_instance`, bypassing the MCP tool wrapper that owns the `_instance_profiles → profile_name` mapping. The profile lock file was therefore never released, and because `profile_manager.is_profile_locked` checks the lock's recorded PID against running processes — and the recorded PID is the still-alive MCP server itself — the stale-PID detector never fired. Every future spawn with `profile="default"` (now the default) hit the acquire-lock raise forever. (2) When a Chrome process is torn down abnormally it leaves `SingletonLock`/`SingletonSocket`/`SingletonCookie` files in its user-data-dir, and nodriver's next spawn into the same dir surfaces the cryptic "Failed to connect to browser — running as root" error. Round 9 fixes: (a) New `server._reconcile_profile_locks()` walks `_instance_profiles`, compares against live `browser_manager.list_instances()`, and releases any lock whose owning instance is no longer alive. Called from `_idle_cleanup_loop` (immediately after every idle sweep) AND from the top of `spawn_browser` before `acquire_lock`, so a stale lock self-heals on the next spawn attempt instead of stalling the entire MCP server session. (b) New `server._cleanup_stale_chrome_singletons(user_data_dir)` is called from `spawn_browser` right after lock acquisition (when we know no live instance can be using the dir) and removes any orphaned `SingletonLock`/`SingletonSocket`/`SingletonCookie` — uses `os.path.lexists` + `os.unlink` because `SingletonLock` is usually a dangling symlink. (c) Mirrored to `src-tauri/mcp-servers/browser/src/server.py`. 8 new unit tests in `tests/test_profile_lock_reconcile.py`. See `docs/browser/efficiency-improvements.md` Round 9.
- **"All Projects" selection not persisted across restarts**: The `active_project` setting was only written when a specific project was selected. Switching to "All Projects" (null) left the old ID in the setting. Now always writes the setting — `""` for All Projects, the ID for a specific project. Startup distinguishes "never set" (auto-select if single project) from `""` (user explicitly chose All Projects).
- **Inbox shows two entries per run (started + completed)**: The bridge was creating a second event when a run completed instead of updating the existing "started" row. Added `upsertRunEvent` — updates the active event for the same `runId` in place. The frontend handles the new `inbox.eventUpdated` IPC event via `updateEventInStore`.
- **Inbox nav-back lands too high**: Scroll restoration applied `pendingScrollTop` before `fetchInitial` refreshed events. If stale events were in the store, the DOM was at its old height, the browser clamped `scrollTop`, and then new events loaded at a shifted offset. Fix: gate the `scrollTop` write until `loading` has cycled `false→true→false` (fetchInitial complete, DOM fully populated), then apply with double-rAF for layout stability.
- **Inbox missing run events when a project is selected**: Executor was emitting `run.statusChanged` without `jobId` in most code paths. The inbox-bridge fell back to an empty `projectId = ""` for those events, so they were invisible when filtering by project. The bridge now falls back to `getRun(runId)` → `jobId` lookup when `jobId` is absent from the event. A v4 backfill step repairs all existing run inbox events that have an empty/null projectId.
- **Active project not restored on app restart**: `getSetting("active_project")` could throw (IPC error on startup) and was not individually caught, causing the outer try-block to bail before calling `setActiveProjectId`. Wrapped with `.catch(() => null)` so a transient failure degrades gracefully rather than silently leaving the project selector in the default state.
- **Reliable element clicking**: `click_element` now uses a multi-strategy cascade (CSS, XPath conversion, text search, shadow DOM piercing) with up to 3 retries and exponential backoff. Scrolls between retries to trigger lazy-loaded content. Pre-interaction preparation ensures elements are visible and not covered by overlays. Rich diagnostic error messages list nearby clickable elements and suggest alternative selectors.
- **`get_page_digest` timeout on complex SPAs**: Added 15s timeout + depth limit on CDP `getFullAXTree()`, 5000-node cap, and JS fallback that extracts headings/links/buttons/text when the accessibility tree is too large (e.g. Reddit).
- **`find_by_role` / `get_page_digest` hanging 120s on Reddit**: Setup CDP calls (`Accessibility.enable`, `DOM.getDocument`) were not individually timeout-wrapped, so a hang in either blew the full 120s MCP tool timeout with no diagnostic. Introduced a `_cdp()` helper that wraps every CDP call in `asyncio.wait_for` (8s default) and a total function-level guard (`_FN_TOTAL_TIMEOUT_S = 25s`) on `get_page_digest`, `find_on_page`, and `find_by_role`. Timeouts now return user-actionable error messages ("DOM is unresponsive — try reload_page or find_on_page instead") instead of a generic "took too long". Also strengthened the browser MCP preamble to force `get_page_digest` as the first tool call after navigation (previously agents were jumping straight to `query_elements`/`find_by_role`) and added a fallback protocol for timeout errors. See `docs/browser/efficiency-improvements.md` for full post-mortem.
- **`get_page_digest` still slow on Reddit after Round 1 fix**: Even with per-call timeouts, the CDP Accessibility tree path was too expensive on heavy SPAs, and the JS fallback used wildcard selectors like `[class*="text"]` that match thousands of hashed Reddit class names. Rewrote `get_page_digest` to default to a new JS-first "fast" mode: narrow tag/role selector list (no wildcards), 3000-element scan cap, 4s JS-side `performance.now()` budget, viewport-proximity filter (only scans elements within ~3 screen heights of current scroll). Target: <2s on Reddit home. The old CDP AX tree path remains available via `mode="semantic"`. All metadata `tab.evaluate()` calls also now individually timeout-wrapped.
- **`navigate` hanging 120s on Reddit**: Default `wait_until="load"` waited for the browser load event which never fires on Reddit due to trackers/analytics; nodriver's `tab.get()` cancellation was also unreliable. Changed default `wait_until` to `"domcontentloaded"`, default `timeout` to 20s, added `"none"` mode (no wait). Replaced `tab.get(url)` with raw `tab.send(Page.navigate(...))` for cancellation safety. Wait branches now treat timeouts as warnings (logged, non-fatal) and return control to the caller — the DOM is usually interactable even when the load event never fires. `window.location.href` / `document.title` reads individually wrapped in 3s timeouts. CAPTCHA detection wrapped in 5s timeout.
- **`find_on_page` returns composer trigger wrapper; paste_text gives up on Reddit (Run ff8198fe)**: Run ff8198fe partially succeeded — the agent posted one Reddit comment but wasted turns on post 1 and abandoned posts 2-3 after a single failed paste_text. Root causes: (1) `find_on_page("Join the conversation")` returned a selector pointing at Reddit's `<faceplate-textarea-input data-testid="trigger-button">` composer trigger wrapper, not the hidden Lexical editor inside. The resolver picked the visible wrapper but marked `editor_kind: unknown` and proceeded to paste 0 chars into a non-writable custom element. (2) `findActivator`'s clickable-element list didn't include Reddit's custom elements (`faceplate-textarea-input`, `shreddit-composer`, `comment-composer-host`) or `[aria-placeholder]`/`[data-testid*="trigger"]`, so the activator scan found nothing on pages where the editor was hidden. (3) `_open_collapsed_editor` only re-resolved with the ORIGINAL selector — useless when that selector was laser-specific to the trigger wrapper. (4) Only one click attempt, 0.6s wait. Round 5 fixes: new `is_real_editor` resolver flag; `findActivator` runs in two scenarios now (hidden target AND visible-but-not-a-real-editor wrapper); clickable selector broadened to cover Reddit Web Components and `[aria-placeholder]`/`[data-testid*="trigger"]`; text matching also checks `aria-placeholder` / `title` / `data-testid`; `_open_collapsed_editor` loops up to 2 attempts with waits 0.6s/1.2s and, crucially, falls back to a generic-editor document scan (`textarea, [contenteditable="true"], [role="textbox"][contenteditable="true"], [data-lexical-editor="true"]`) if the original selector can't reach the revealed editor — this is the path that makes the Reddit comment flow work end-to-end because after clicking the trigger wrapper the real Lexical editor lives in a completely different subtree. New `_click_via_js` helper dispatches the full `pointerdown → mousedown → pointerup → mouseup → click` event sequence (not just `.click()`) so React/Lexical composer listeners get triggered. Preamble rule D adds "do NOT give up after a single failed paste_text — retry at least twice with different approaches". 2 new tests + 1 updated. See `docs/browser/efficiency-improvements.md` Round 5.
- **Hidden comment editors + unusable `find_on_page` results (Run 33c3ef25)**: After Round 3, Reddit comment attempts resolved to the correct `div[name="body"]` contenteditable but `paste_text` kept returning `inserted_chars: 0` because the Lexical editor is collapsed behind a "Join the conversation" placeholder until clicked. Separately, `find_on_page("Join the conversation")` failed first with "DOM agent is not enabled" and on retry returned matches with every useful field null (`selector_hint: null`, `position: null`, `scrolled_to: false`) — CDP `DOM.performSearch` node IDs couldn't be resolved on Reddit's SPA. Round 4 fixes: (1) `_resolve_input_target` now runs a `findActivator` JS pass that walks up to 10 ancestors of a hidden editor looking for a visible clickable whose text matches a generic regex (`join the conversation`, `add a comment`, `write a reply`, `leave a comment`, etc.). If found, the activator is tagged and returned as `activator_selector`. (2) New `_open_collapsed_editor` is called automatically from `paste_text`/`type_text` when the target is hidden: clicks the activator via JS cascade (`.click()` → synthetic MouseEvent), waits 600ms, re-resolves against the original selector, and replaces the resolved dict if the editor is now visible. If it's still hidden after the click, the verification warnings tell the agent the composer wants a real mouse gesture and to click the activator manually via `click_element`. (3) `find_on_page` rewritten as a single JS evaluate (no CDP DOM.performSearch): tries XPath, then CSS, then case-insensitive text search across interactive tags, sorts to prefer visible + shortest text, tags the match with `data-oh-find="1"`, and **always** returns a usable `selector_hint`. Uses JS `scrollIntoView` and `getBoundingClientRect` — no CDP node-ID resolution that can silently fail. (4) Preamble rule D rewritten to describe the auto-activator behaviour; new rule E advertises the reliable `selector_hint` shape. 9 new tests (5 for activator/hidden-editor verification, 4 for `find_on_page` JS-first). Also documented that `(truncated)` markers in run logs come from `stream-parser.ts:166`/`:178` display truncation — the AI receives the full MCP tool output over the wire. See `docs/browser/efficiency-improvements.md` Round 4.
- **`paste_text`/`type_text` silently pasting into the wrong element (Run 700f4539)**: A comma-separated union selector like `textarea, [contenteditable], input[type="text"]` silently resolved to Reddit's global search box (the first DOM match), and `paste_text` returned `True` — so the agent confidently claimed it had commented when no comment ever existed. Fix: (1) New `_resolve_input_target` JS helper splits union selectors, scores every candidate (contenteditable/textarea > non-search input > search input, with visibility and placeholder/aria hints), and returns the best writable target instead of DOM-first. (2) `paste_text`/`type_text` now return a VERIFICATION DICT (`success`, `verified`, `expected_chars`, `inserted_chars`, `field_preview`, `resolved_target`, `warnings`) rather than a bare `bool` — the dict is built by reading the field back after insertion. (3) If the resolved target looks like a search input and the text is > 200 chars, paste/type raise with a pointed error telling the agent to use `find_on_page("Add a comment")`. (4) For contenteditables, if the first `execCommand('insertText')` attempt leaves the field empty (Lexical/ProseMirror quirk), paste_text automatically retries via raw CDP `Input.insertText` before reporting failure. (5) The browser MCP preamble grows a mandatory "FORM INPUT + SUBMISSION VERIFICATION" section: no union selectors for paste/type/click, always check `verified`/`warnings`, and after clicking any submit button the next call MUST be `get_page_digest` to confirm the editor closed and the new comment appeared. 9 new unit tests in `tests/test_input_verification.py`. See `docs/browser/efficiency-improvements.md` Round 3 for the full post-mortem.
- **Intermittent "No such tool available" MCP startup failures**: Added pre-flight path validation in `buildMcpConfig` (verifies Python binary, server module, and cwd exist before including in config). Added post-write verification in `writeMcpConfigFile` (reads back and validates JSON). Changed `cleanupOrphanedConfigs` to only delete configs older than 5 minutes (was deleting all configs at startup, creating a race window). Added existence check in executor before passing config to Claude Code.
- **`spawn_browser` rejected hallucinated kwargs + ephemeral-profile trap (Run b4824c2d)**: Three related regressions surfaced during an OpenClaw outreach run: (1) The agent called `spawn_browser(instance_id="search_session")` trying to name the returned session; FastMCP/Pydantic rejected the call with `Unexpected keyword argument`, burning a tool turn. (2) Fresh-profile spawns (no `profile=`) created an ephemeral Chrome user-data dir every time, so the first navigate to Reddit hit a "Prove your humanity" page; the agent closed the instance, spawned again, and abandoned Reddit for the rest of the run. (3) Same root cause for an unauthenticated HackerNews first-spawn. Round 7 fixes: (a) `spawn_browser` absorbs `instance_id`/`name`/`session_name`/`id` as ignored aliases with a stderr warning (no more hard failure on LLM-hallucinated param names). (b) `spawn_browser` defaults to `profile="default"` when neither `profile` nor `user_data_dir` is supplied — cookies/sessions now persist across spawns automatically. Explicit opt-out via `user_data_dir=""`. (c) `BROWSER_PROFILE_PREAMBLE` rewritten to document the default-profile fallback, forbid inventing per-task profile names (`"search_session"`, `"hn_browser"`), and add a mechanical anti-bot recovery protocol (reload → re-spawn with site profile → `request_user_help`) before abandoning any target platform. (d) Mirrored to `src-tauri/mcp-servers/browser/src/server.py`. 5 new signature/source-level tests in `tests/test_spawn_browser_kwargs.py`. See `docs/browser/efficiency-improvements.md` Round 7.
- **Claude hallucinates `mcp__openhelm_browser__*` (underscore) instead of `mcp__openhelm-browser__*` (hyphen) (Run c5c6cd88)**: An OpenClaw outreach run failed within seconds because Claude called `mcp__openhelm_browser__spawn_browser` (underscore) instead of the real `mcp__openhelm-browser__spawn_browser` (hyphen). Round 6's auto-retry caught and recovered it, but each occurrence still burns a run + ~1 minute of wall time + tokens, and leaves a confusing "failed" entry in the user's history. Root cause: `mcp__SERVER__TOOL` makes double-underscore the natural delimiter, and every other MCP server we use has an underscore-safe name — `openhelm-browser` is the odd one out, so "`openhelm_browser` feels right" is a strong prior for the model. Preamble rules telling the agent "use the hyphen" have been in the system prompt for weeks and the hallucination still recurs. Round 8 fix: **stop fighting the tokenisation bias — rename the MCP server key to match what Claude naturally produces.** Changed `buildMcpConfig`'s server keys from `"openhelm-browser"` → `"openhelm_browser"` and `"openhelm-data"` → `"openhelm_data"`; updated every `mcp__openhelm-browser__*` reference in `BROWSER_MCP_PREAMBLE`, `BROWSER_SYSTEM_PROMPT`, and `DATA_TABLES_MCP_PREAMBLE`; updated the data-tables MCP server's self-reported `serverInfo.name`; relaxed the tool-name regex in `tool-usage-chart.tsx` to `^mcp__(.+?)__(.+)$` so both new (`openhelm_browser`) and legacy (`openhelm-browser`) stats render identically. Python `pyproject.toml` package names left as-is (pip metadata is independent of the MCP server key). Added 3 new regression-guard tests in `test/mcp-config-builder.test.ts` (underscore server key is present AND hyphen is NOT; Round 6 path-skip behaviour; Round 6 5-minute cleanup grace window) and fixed 5 pre-existing tests that had silently broken when Round 6 added `existsSync` path validation but never updated the test fixtures. All 959 agent tests pass. See `docs/browser/efficiency-improvements.md` Round 8.
- **Transient "No such tool available: mcp__openhelm-browser__*" still burning whole runs (Run 04cb3695)**: Even with Phase 6 hardening, a Reddit engagement run failed within seconds because the Python browser MCP's cold-start imports (nodriver + ~15 local modules + stealth patches) occasionally overran Claude Code's MCP init budget. The failure was only detected post-mortem by `hasMcpToolMissingError` and routed through LLM-driven self-correction, which cannot help when the session has no tools. Round 6 fixes: (1) `agent/src/claude-code/runner.ts` now sets `MCP_TIMEOUT=60000` and `MCP_TOOL_TIMEOUT=120000` on every spawned Claude Code process so cold-start Python imports have ample budget. (2) `agent/src/executor/index.ts::onRunCompleted` now force-fails exit-code-0 runs when `hasMcpToolMissingError(runId)` is true (was quietly being marked `succeeded` if outcome assessment returned nothing), then bypasses self-correction entirely and enqueues a fresh auto-retry via `createRun({ triggerSource: "manual", parentRunId: runId })`. The retry uses `triggerSource: "manual"` (not `corrective`) so it spawns a brand-new Claude Code process with a fresh MCP server instead of resuming the failed session. Bounded to one retry per lineage: if the failing run itself has a `parentRunId`, no further retry is created — stateless loop prevention with no counters or TTLs. The retry calls `this.forceRun(retryRun.id)` (not just enqueue + `processNext()`) so it runs even when `scheduler_paused=true` — an MCP auto-retry is logically a continuation of an in-flight run, not new scheduled work, and the pause guard would otherwise leave it stuck forever (see Run d92edd14 regression test). A stderr breadcrumb is written to the retry run explaining why it was created. Net effect: a transient MCP flake now costs ~10s of extra latency instead of a wasted run. 2 new tests in `test/executor.test.ts` (`Executor MCP tool-missing auto-retry`). See `docs/browser/efficiency-improvements.md` Round 6.

## [0.8.0] - 2026-04-05

### Added
- **Unified page headers with search & filter**: New shared `PageHeader` and `FilterBar` components provide consistent search/filter UI across Data Tables, Memory, Credentials, and Inbox pages
- **Data Tables project labels**: Each table card now shows which project it belongs to when viewing "All Projects"
- **Data Tables search & project filter**: Search tables by name/description and filter by project
- **Inbox search & category filter**: Search events by title/body and filter by category (Runs, Alerts, Actions, etc.)
- **Credentials search**: Text search across credential names

### Fixed
- **Stuck unfired investigation jobs + leftover "AutoCaptain" branding**: Some investigation jobs were created with `next_fire_at = NULL` (likely a race condition during scanner spawn) and never fired. Migration 0038 archives these stuck jobs (the scanner will re-spawn if the breach persists) and rewrites persisted "AutoCaptain"/"Captain Rules"/"Captain Metrics" strings to their new "Autopilot" names across job descriptions/prompts, data table descriptions, inbox items, and inbox events. Also updated the `Captain scan:` inbox event title and stale `AutoCaptain` comments in source.
- **Completed investigation jobs cluttering Autopilot Maintenance goal**: One-shot `Investigate: X` jobs were disabled by the scheduler after firing but never archived, piling up as "paused" clutter (90+ per project over a few days). Post-run handler now archives them immediately after creating the dashboard insight. Migration 0036 cleans up existing ones by archiving any `captain_investigation` job that has a terminal run; unfired jobs are left alone so the scheduler can still fire them.
- **Duplicate Autopilot Maintenance goals**: A bug in the autopilot scanner caused a new "Autopilot Maintenance" system goal (with a "Health Rules Review" job) to be created every 30 minutes per project, resulting in hundreds of duplicate goals and jobs. Added migration 0035 that automatically deduplicates on upgrade (keeps the oldest goal per project, deletes duplicates and their orphaned jobs/targets/runs). Added a unique partial index to prevent recurrence at the database level. Also fixed `CreateGoalParams` missing `icon` field.
- **CDP connection lost after auto_login**: Form submission triggers page navigation, but `auto_login()` returned immediately without waiting for the page to load. The next tool call would hit a stale CDP tab mid-navigation and incorrectly report "Browser CDP connection lost". Now waits for `LoadEventFired` (up to 15s) plus 1s settle time after form submit.
- **get_tab CDP validation too aggressive during navigation**: The 5-second `tab.evaluate("1")` probe would timeout during active page navigation (e.g. after login redirect) and permanently mark the browser as errored. Now retries up to 3 times with increasing timeouts (5s/8s/11s) to handle transient navigation states. Hard connection errors (socket refused) still fail immediately.
- **auto_login selectors miss common sites**: Default username selectors now include `input[name="acct"]` (Hacker News), `input[name="user"]`, and password selector includes `input[name="pw"]` (HN).
- **check_session hangs on unresponsive browser**: `check_session_cookies()` CDP calls now have a 10-second timeout. Returns a clear error message instead of hanging until the 60s tool timeout.
- **Inbox zoom slider UX**: Replaced inline zoom label with a centered mini-toast that appears on zoom changes. Slider now snaps to discrete tier stops only, preventing empty zoom levels with no events. Slider is hidden when only one tier exists.
- **Historic events not appearing in Inbox**: Fixed backfill guard that skipped historic run/alert backfill when any inbox events already existed. Backfill now runs with deduplication (versioned key `inbox_backfill_v2`).
- **Chat thread messages shown verbatim in Inbox**: Side-panel chat conversations now display as a summary card (thread name + last updated time) instead of raw message content.
- **Now button stuck visible / wrong arrow direction**: Now button immediately hides when clicked, and arrow flips to point up when user has scrolled past Now into the future.
- **Reply arrow on wrong side**: Moved the reply-on-hover button from left to right side of inbox events.

### Changed
- **Nautical-themed input placeholders**: Both inbox and chat panel input fields now show random nautical/ship-themed placeholder text instead of generic "Message your AI assistant...".

### Fixed
- **Credentials not injected for corrective (retry) runs**: When a run failed and triggered a corrective retry, the entire credential injection block was skipped because the resume path assumed the parent session still had credentials. Since MCP servers are respawned fresh, browser credentials were never written, causing all credential-dependent corrective runs to fail with "credentials not available". Credentials are now always resolved regardless of resume path.
- **Agent appears hung after macOS sleep/wake**: The heartbeat mechanism declared the agent dead after a single missed ping (10s timeout). After macOS sleep/wake or CPU spikes, the agent can be transiently slow. Now requires 3 consecutive heartbeat failures before declaring the agent unresponsive. Additionally, a recovery probe now periodically pings the agent after it is declared hung — if the agent becomes responsive again, the UI auto-recovers without requiring an app restart.
- **Browser MCP CDP connection validation**: The browser MCP's `get_tab()` now validates the CDP connection is alive before returning the tab reference. When the connection has dropped (e.g. browser crash, macOS sleep), it raises a clear error message telling the agent to spawn a new browser instead of failing deep inside a tool operation.

### Added
- **Persistent browser profiles**: Named Chrome profiles (`~/.openhelm/profiles/`) for session reuse across automation runs
  - New `profile_manager.py` module with CRUD, locking, and session cookie checking
  - `spawn_browser(profile="name")` parameter auto-creates and locks profiles
  - `check_session(instance_id, domain)` verifies login status via known auth cookies
  - Profile locks prevent Chrome conflicts when concurrent tasks share profiles
  - `list_profiles` and `create_profile` MCP tools for profile management
- **Behavioral variance injection**: Human-like interaction patterns to avoid bot detection
  - New `behavior.py` module with Bezier mouse paths, humanized click/type delays, scroll jitter
  - `humanize` parameter on `click_element` and `type_text` (default True)
  - Truncated normal distribution for delays (not uniform — humans cluster around the mean)
  - Deterministic mode via `OPENHELM_DETERMINISTIC=1` for test stability
- **Browser session setup flow**: Post-save credential UX for one-time manual login
  - "Browser only" credentials now offer to open Chrome for manual login after saving
  - Sessions persist in named profiles, reused automatically in future automation runs
  - Credentials remain saved for scope switching (env var, prompt modes)
- **Profile-aware task queuing**: Executor skips queue items whose browser profiles are locked
  - Tasks wait in queue until the required profile is freed, then run automatically
  - `browserProfileName` column on credentials table links profiles to credentials
  - Profile locks released on run completion, failure, or agent restart
- **MCP system prompt**: Claude now uses persistent profiles and checks session validity automatically
- **Intervention section**: Renamed MCP `captcha` section to `intervention` (covers CAPTCHAs + re-auth prompts)
  - `request_user_help` docstring updated to include session re-authentication use case
  - `--disable-captcha` flag kept as backwards-compatible alias for `--disable-intervention`
- **Inbox page**: New unified event timeline replacing Dashboard Alerts & Actions section
  - Vertical scrolling timeline of all OpenHelm events (runs, alerts, AI messages, data/memory/credential changes, scheduled jobs)
  - Importance-based tiering (0-100 scale) with dynamic tier grouping via natural-break algorithm
  - Zoom between detail levels via tier slider or pinch-to-zoom gesture (ctrl+scroll)
  - Master chat input for messaging the AI directly from the Inbox timeline
  - Inline reply to any event in the timeline
  - Future events section showing scheduled job runs
  - Smooth Framer Motion animations for tier zoom transitions
- Inbox is now the default landing page (Dashboard retains System + Insights sections)
- New `inbox_events` database table (migration 0033) for event storage
- Centralized inbox event bridge converts IPC events to timeline events automatically
- Programmatic importance scoring with contextual modifiers (no LLM required)
- Dedicated inbox conversation channel (separate from sidebar chat threads)

## [0.7.1] - 2026-04-03

### Fixed
- Browser cleanup: Chrome instances spawned by openhelm-browser MCP were not being killed after job runs completed, accumulating in the macOS Dock
  - `find_pid_on_port` was using `lsof -ti :PORT` which returned the Python MCP server PID (CDP client) instead of the Chrome PID (CDP server); fixed to use `lsof -t -i TCP:PORT -sTCP:LISTEN`
  - Agent-side cleanup now scans for orphaned nodriver Chrome processes (by `uc_*` temp dir pattern) as a fallback when PID tracking fails
  - Python MCP server shutdown cleanup now also scans for orphaned nodriver Chrome processes instead of relying solely on tracked PIDs

## [0.7.0] - 2026-04-02

### Added
- Autopilot autonomous overhaul: significantly enhanced autopilot system to operate more independently with improved goal planning and execution
- New scanner module for intelligent goal discovery and analysis
- New metrics module for tracking autopilot performance and outcomes
- Post-run assessment system for evaluating job results

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4, and OpenTelemetry transitive updates
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, `js-sys`/`web-sys` 0.3.93→0.3.94, and related updates

### Security
- Reject non-absolute file paths in `data.export`, `data.importPreview`, and `data.importExecute` IPC handlers to prevent path traversal attacks via the dev bridge

## [0.6.1] - 2026-04-02

### Fixed
- Sentry OPENHELM-14/15: goal.children crash on drag-and-drop
- Various bug fixes and stability improvements

### Changed
- Sidebar UX improvements and other minor enhancements

## [0.6.0] - 2026-04-01

### Added
- Goal hierarchy: support for parent-child goal relationships with cascading status updates
- Chat tools for targets: AI chat can now list, retrieve, and evaluate targets within conversations
- Chat tools for visualizations: AI chat can now suggest and manage data table visualizations
- Enhanced system prompt: improved formatting and capabilities for target evaluation and visualization suggestions

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, and related transitive updates

### Fixed
- Chat streaming deduplication: chunks shorter than accumulated text were incorrectly re-emitted, potentially doubling words in the output; fixed by using `totalStreamedText.startsWith(stripped)` to reliably detect already-emitted subsets

## [0.5.3] - 2026-04-01

### Fixed
- Data table chart creation: filter out empty column/data entries before rendering to prevent Radix validation errors
- Sentry noise: suppress expected "message already being processed" errors (user-triggered double-send race, handled in UI)
- Sentry noise: suppress spurious events from OS-level pipe teardown on sidecar exit
- AppShell: guard `startDragging()` call behind Tauri internals check to prevent crashes in dev bridge HTTP context
- Chat improvements: better error handling and UX enhancements

## [Unreleased]

### Security
- Reject non-absolute file paths in `data.export`, `data.importPreview`, and `data.importExecute` IPC handlers to prevent path traversal attacks via the dev bridge

### Fixed
- Chat streaming deduplication: chunks shorter than accumulated text were incorrectly re-emitted, potentially doubling words in the output; fixed by using `totalStreamedText.startsWith(stripped)` to reliably detect already-emitted subsets

### Changed
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.45→10.46, `posthog-js` 1.364.1→1.364.3, `rollup` + `@rollup/rollup-darwin-arm64` 4.60.0→4.60.1, `vitest` 4.1.1→4.1.2
- Bump safe npm dependencies: `@sentry/react` + `@sentry/node` 10.46→10.47, `posthog-js` 1.364.3→1.364.4, plus OpenTelemetry instrumentation transitive updates
- Bump Rust crates: `tao` 0.34.6→0.34.8, `wry` 0.54.2→0.54.4, `darling` 0.21→0.23, `serde_with` 3.17→3.18, `time` 0.3.45→0.3.47, `wasm-bindgen` 0.2.114→0.2.116, plus numerous other compatible updates
- Bump Rust crates: `hyper` 1.8.1→1.9.0, `wasm-bindgen` 0.2.116→0.2.117, `js-sys`/`web-sys` 0.3.93→0.3.94, `serde_spanned` 1.1.0→1.1.1, `toml_*` patch updates

## [0.5.2] - 2026-04-01

### Added
- Chat data table tools: the AI chat sidebar can now CRUD data tables (list, get, create, insert rows, update rows, delete) — previously only available during job runs via MCP

### Fixed
- Chat AI correctly uses XML tools for OpenHelm data queries (goals, jobs, data tables) instead of native Bash/Agent tools; achieved via `--disallowed-tools Bash,Agent` + `--allowed-tools` whitelist
- Tool loop session resumption no longer crashes when first call used `--no-session-persistence`; each iteration now independently starts a fresh Claude Code session
- Chat streaming text no longer runs sentences together when tool calls are stripped or across tool-loop iterations
- Thread delete button now available even when only one thread remains

## [0.5.1] - 2026-03-31

### Fixed
- Test fixes: improved test coverage and stability
- Minor improvements: performance and stability enhancements

## [0.5.0] - 2026-03-30

### Added
- Multi-thread chat: users can create multiple conversation threads per project with compact horizontal pill tabs
- Thread management: create, rename, delete, clear history, and drag-to-reorder chat threads — all via per-tab dropdown menu
- Auto-rename threads: new threads are automatically given a descriptive title after the first message (non-blocking LLM call)
- Simultaneous conversations: switch between threads while LLM processes in another — each thread tracks its own sending/streaming state independently
- Data Visualizations: chart rendering for data table contents using Recharts (line, bar, area, pie, stat chart types)
- Dashboard redesigned with tabbed layout: Alerts & Actions, System, and Insights tabs
- Insights tab: target progress grouped by goal, data table charts grouped by project
- Visualization auto-suggestion: autopilot deterministically detects numeric data table columns and suggests charts (gated by autopilot mode)
- Charts integrated into goal detail view and job detail panel
- New MCP tools: `list_visualizations`, `create_visualization`, `update_visualization`, `delete_visualization` — AI jobs can create charts during runs
- New `visualizations` DB table (migration 0029) with full CRUD, cascade delete on data table removal
- Suggested charts appear on Dashboard with Accept/Dismiss actions
- Startup backfill: auto-suggests visualizations for existing data tables with sufficient numeric data

### Improved
- Chat response speed: pre-warm embedding model at agent startup (eliminates 2-5s first-message delay)
- Chat response speed: session reuse within tool loops (avoids CLI cold-start on subsequent iterations)
- Chat response speed: cache static system prompt sections (tools, rules, native tools)
- Chat response speed: parallelize async prompt building with sync DB operations
- Chat default model changed from Sonnet to Haiku for faster time-to-first-token (users can still select Sonnet/Opus)

### Refactored
- Extracted chat action handlers to `agent/src/chat/action-handler.ts` (handler.ts file size reduction)
- Extracted print stream parsers to `agent/src/claude-code/print-parser.ts` (print.ts file size reduction)

### Fixed
- Streaming text duplication: deduplicate cumulative text chunks from CLI so streamed responses no longer appear doubled during generation
- Thread tab switching: clicking an inactive thread pill now switches to it correctly; dropdown (rename/delete) is now accessed via a separate chevron button on each pill
- Chat error reporting: extract error details from Claude Code stream-json result events when stderr is empty (fixes unhelpful "no stderr" error messages)
- Chat resilience: auto-retry LLM calls on transient failures (exit code 1, timeouts) with up to 2 retries and exponential backoff

## [0.4.2] - 2026-03-29

### Added
- Target tracking support: track and monitor Claude Code run targets with automatic coordination

### Fixed
- Browser automation efficiencies: reduced resource overhead and improved performance during browser-based Claude Code runs

## [0.4.1] - 2026-03-29

### Added
- Claude Code Usage Dashboard: three stat cards (Today, This Week All, This Week Sonnet) mirroring `/usage` output, with OpenHelm vs total breakdown and comparison to previous period
- 30-day SVG line chart showing token usage trend (total vs OpenHelm), with hover tooltips
- Total usage tracking: reads `~/.claude/projects/**/*.jsonl` to capture all Claude Code sessions (not just OpenHelm-initiated ones); falls back to OpenHelm-only if unavailable
- JSONL deduplication: skips streaming-start placeholder entries by detecting parent→child assistant-turn chains
- Usage alert system: macOS notifications at 50%, 75%, 90% of configurable daily/weekly token budgets; per-threshold deduplication via settings keys prevents repeat alerts within the same period
- New settings keys: `claude_daily_budget` and `claude_weekly_budget` for user-configurable alert thresholds
- New DB table `claude_usage_snapshots` (migration 0027) for per-day usage aggregates
- Health monitoring: reactive detection of Claude Code authentication failures and MCP server unavailability from run stderr
- New dashboard alert types: `auth_required` (with "I've Re-authenticated" action) and `mcp_unavailable`
- Auto-pause scheduler on auth failure to prevent cascading run failures
- Auto-resume interrupted jobs when the user confirms re-authentication via dashboard
- Native macOS notifications for auth and MCP alerts
- Health banner auto-rechecks when auth_required events arrive

## [0.4.0] - 2026-03-29

### Added
- Data Tables: Notion-style structured data tables that both users and AI can create, read, update, and delete
- New "Data" tab in sidebar with table list view and Notion-style grid detail view
- 8 column types: text, number, date, checkbox, select, multi-select, URL, email
- Inline cell editing with type-appropriate editors
- Data Tables MCP server (`openhelm-data`): automatically available in all Claude Code runs, enabling AI to list/query/create/insert/update/delete tables
- Semantic relevance: table schemas are embedded via all-MiniLM-L6-v2 and injected into job prompts when relevant
- Audit trail: all mutations logged with actor (user/ai/system) and run ID
- Type coercion on AI writes: fuzzy-matches select labels, parses string numbers, normalizes dates
- Rate limiting: 100 mutations per MCP tool call to prevent runaway AI loops
- 3 new database tables: `data_tables`, `data_table_rows`, `data_table_changes`

### Fixed
- Chat concurrency guard: prevent sending a second message while the first is still being processed, avoiding concurrent Claude Code CLI processes that could interfere with each other
- Chat stuck-sending fix: clear the sending/status state when switching projects and when error events arrive for a different project thread, preventing the chat input from being permanently locked

## [0.3.1] - 2026-03-28

### Added
- Browser CAPTCHA detection: detects when Claude Code encounters CAPTCHA pages and sends an intervention event so the user can manually solve it
- macOS background process launching: improved handling for spawning browser processes in the background without stealing focus
- Browser process cleanup and intervention handling: prevents zombie processes and tracks user interventions during browser automation runs
- Browser credential injection: credentials marked as "browser" are automatically injected into browser environments before Claude Code runs

### Fixed
- Browser MCP handler now correctly validates environment before attempting browser operations
- Improved test coverage for browser MCP integration and credential handling

## [0.3.0] - 2026-03-28

### Added
- Built-in browser MCP server: integrated stealth-browser-mcp as a bundled MCP server (`openhelm-browser`) with all 95 tools, automatically injected into Claude Code runs via `--mcp-config`
- Per-tool-call timeouts for browser automation: 60s default, 120s for screenshots and heavy operations — prevents indefinite MCP tool hangs that previously caused 600s silence timeouts
- Python venv auto-setup: on first use, detects Python 3.10–3.13 (3.14+ excluded due to pydantic-core/PyO3 compatibility), creates a virtual environment, and installs browser automation dependencies
- IPC handlers (`browserMcp.status`, `browserMcp.setup`) for frontend browser MCP status checks and manual setup
- Orphaned MCP config file cleanup at agent startup
- Browser MCP preference note prepended to job prompts when `openhelm-browser` is available, encouraging Claude to prefer the built-in timeout-protected server over any globally-installed browser MCP unless the prompt explicitly requests a different one

## [0.2.2] - 2026-03-28

### Fixed
- Security: validate username against an allowlist regex before interpolating into the osascript admin shell command in `wake-scheduler.ts`, preventing shell injection if `$USER` contains unusual characters
- Bug: `handleApproveAll` now sorts `create_goal` actions before `create_job` actions so FK links are valid even when the LLM emitted jobs before their parent goal
- Bug: standalone job sort-order query now excludes goal-attached jobs from the `MAX()` calculation, preventing inflated `sortOrder` values for standalone jobs
- Bug: chat message pagination (`beforeId`) now uses `id` as a tiebreaker when two messages share the same `createdAt` timestamp, preventing messages from being silently skipped
- Bug: memory extractor now logs a warning when the LLM returns `action:"update"` without a `mergeTargetId` (previously fell through to create silently)
- UX: inline job name input in sidebar goal nodes now submits on blur (consistent with goal name input behaviour)
- Code clarity: added comments documenting the `"pending"` sentinel goalId convention and the username injection guard

## [0.2.1] - 2026-03-27

### Added
- Per-project chat threads: each project now has its own independent conversation history, and switching projects switches the chat thread
- "All Projects" chat thread: a separate conversation thread is available when viewing all projects, with cross-project read tool access
- Visual thread indicator in the chat panel header showing which project (or "All Projects") the current thread belongs to
- Chat button and panel are now always visible, even when "All Projects" filter is selected

### Fixed
- Fix autopilot system jobs never being generated after goal creation via chat (goalId was extracted from wrong field in pending actions)
- Fix automatic memory extraction never creating memories — CLI structured output (via `--json-schema`) was returned as a `StructuredOutput` tool call / `structured_output` field, but the parser only looked for text blocks, silently returning empty results. This also affected all other `jsonSchema` callers (assessment, plan generation, failure analysis, correction evaluation).
- Fix migration 0021 missing statement-breakpoint markers, causing test DB initialization to fail
- Resolve merge conflict and stabilize agent bundling for v0.2.1 release

### Added
- "Generate" button on goal detail view to trigger autopilot system job creation for existing goals
- Emit `memory.extractionFailed` event on extraction parse failures for better diagnostics

## [0.2.0] - 2026-03-25

### Added
- Support for autopilot: AI-generated plans that run automatically on schedules
- Credential management system for secure API key and token storage

### Fixed
- Suppress benign IPC errors from Sentry to reduce noise in error tracking (OPENHELM-6, OPENHELM-8)
- Credential support and other stability improvements

## [0.1.18] - 2026-03-24

### Added
- Token tracking for background jobs

### Fixed
- Add hourly background update check for improved reliability

## [0.1.17] - 2026-03-24

### Fixed
- Fix execFileAsync bug in agent sidecar

## [0.1.16] - 2026-03-24

### Fixed
- Updated release workflow configuration

## [0.1.15] - 2026-03-24

### Fixed
- Fix updater manifest URLs to use correct repository path

## [0.1.14] - 2026-03-23

### Fixed
- Fix chat messages leaking across projects when switching: all chat events now include `projectId` and frontend filters events by active project; transient state (status text, streaming preview) is cleared on project switch
- Fix AI referencing wrong project's data in chat: context entities (goals, jobs, runs) are now validated against the current project; stale cross-project IDs from frontend selection state are discarded
- Fix blank AI responses in chat when LLM returns only tool calls: handler now provides contextual fallback content; bubble component gracefully handles empty content with pending actions

## [0.1.13] - 2026-03-22

### Fixed
- Minor fixes and stability improvements

## [0.1.12] - 2026-03-22

### Added
- Claude Code health monitoring hook (`use-claude-health`) for real-time CLI status in the UI
- Onboarding email capture step with tests
- Planner commit summarisation (`planner/commit.ts`)
- Native Rust IPC handlers in `lib.rs` for tighter Tauri integration

### Fixed
- Improved Claude Code detector with expanded version/path detection logic
- Chat panel HITL interaction fixes
- Notifications refactor for reliability
- Job query edge-case fixes
- Sidebar job-node display corrections
- Miscellaneous executor, planner prompt, and app-shell stability fixes

## [0.1.11] - 2026-03-20

### Fixed
- Fix onboarding screen showing after app updates: persisted `onboarding_complete` flag in DB so it survives restarts even when project list hasn't loaded yet
- Fix window not being draggable on the "Starting agent" loading screen: added `data-tauri-drag-region` to the splash screen
- Fix agent crash when dev HTTP bridge port 1421 is already in use (e.g. after update restart): EADDRINUSE is now non-fatal instead of crashing the entire agent process
- Fix frontend hanging indefinitely when agent dies: sidecar termination events are now forwarded to the frontend, immediately rejecting all pending requests
- Fix initial load hanging if any startup request fails: wrapped in try/finally so `initialLoading` always completes

### Changed
- Replace static "Starting agent..." text with rotating sailing-themed phrases (e.g. "Hoisting the mainsail…", "Pulling through the fairlead…")

## [0.1.10] - 2026-03-20

### Fixed
- Minor executor, scheduler, and update-flow fixes

## [0.1.9] - 2026-03-20

### Added
- Update-aware run recovery: running tasks are automatically re-enqueued after an app update instead of being marked as failed
- Pre-update active run check: users are warned when active runs exist before installing an update
- "Wait for Runs" option: users can choose to wait for active runs to finish before the update installs automatically
- `executor.prepareForUpdate` and `executor.cancelPrepareForUpdate` IPC handlers for update lifecycle management

### Fixed
- Numerous stability fixes and improvements

## [0.1.8] - 2026-03-19

### Fixed
- Fix "agent not responding" on all downloaded builds: bundled Node.js binary was codesigned with the hardened runtime but without JIT entitlements, causing V8 to crash with "Fatal process OOM in Failed to reserve virtual memory for CodeRange" before emitting any IPC events

## [0.1.7] - 2026-03-19

### Fixed
- Scheduler fixes and stability improvements

## [0.1.6] - 2026-03-19

### Fixed
- Build pipeline fixes and stability improvements

## [0.1.5] - 2026-03-19

### Fixed
- Minor Sentry integration fix

## [0.1.4] - 2026-03-19

### Added
- License system: license manager, IPC handler, license section in settings, and license banner
- Newsletter integration module
- Chat system: chat handler, chat input component, and updated system prompt
- Onboarding wizard expanded with email, payment, and usage-type steps
- Email validation utility and license utilities

### Fixed
- Settings screen and application section improvements
- Shared types updated for new license and chat features

## [0.1.3] - 2026-03-18

### Added
- Chat handler passes working directory to Claude Code so native tools (file read/edit/write) operate in the correct project directory
- `permissionMode` option added to `PrintConfig` / `buildPrintArgs` for controlling Claude Code permission mode per call
- Newsletter email setting now syncs to Resend on save via `subscribeToNewsletter`
- Chat system prompt documents native Claude Code tools (WebSearch, WebFetch, file tools, MCP)
- `disableTools` and `workingDirectory` options exposed on `LlmCallConfig` for per-call control

### Fixed
- Chat LLM timeout increased from 2 minutes to 5 minutes to accommodate native tool use (web search, file reads)
- `disableTools` now defaults to `true` globally but can be overridden per call (chat disables it to allow native tool use)

## [0.1.2] - 2026-03-18

### Added
- Auto-updates via Tauri updater plugin integrated with GitHub Releases

### Fixed
- ESLint v9 flat config (`eslint.config.js`) added for linting compatibility

## [0.1.1] - 2026-03-18

### Added
- Power management: sleep guard and wake scheduler to keep scheduled jobs running reliably on macOS
- Newsletter opt-in step in onboarding wizard
- GitHub star dialog for community engagement

### Fixed
- CI workflow improvements: fail-fast disabled for build matrix, tsbuildinfo files gitignored
- Release workflow updated to use macos-latest for both targets
- Bundle identifier changed to com.maxbeech.openhelm
- /release command updated to use small/medium/large bump types

## [0.1.0] - Unreleased

### Robustness Improvements
- **Timeout default changed to unlimited**: Hard wall-clock timeout now defaults to 0 (no limit). The silence timeout (10 min) independently catches stuck processes. Users can still opt in to a hard cap via Settings > Execution. Dropdown now includes "No limit" as the first option.
- **Orphaned queued runs safety net**: Scheduler tick now checks for DB runs stuck in "queued" status that aren't in the in-memory queue, and re-enqueues them. This prevents corrective runs (or any run) from being permanently stuck after an agent hiccup.
- **Crash recovery priority fix**: Corrective runs re-enqueued during crash recovery now get priority 2 (was incorrectly 1), matching their original enqueue priority.
- **Renamed correctionContext → postPrompt on jobs**: The job-level `correctionContext` field is now `postPrompt` — a user-facing, editable field. It's auto-populated by self-correction on failure, but users can also set it manually via the job creation/edit forms. Both `postPrompt` (persistent on jobs) and `correctionContext` (per-run snapshot) are appended to the effective prompt, with postPrompt first. DB migration 0012 renames the column.

### Fixed (End-to-End Verification)
- **runner.ts**: Added missing `--verbose` flag required by Claude Code CLI v2.1.71 when using `--print --output-format=stream-json`. Without it all jobs failed immediately with exit code 1.
- **job-creation-sheet.tsx**: Once-type manual jobs set `fireAt: new Date()` which was already past by the time `createJob` ran, causing `nextFireAt = null` and the job never firing. Fixed with `+10_000ms` buffer (same pattern as `commit.ts`).
- **goal-creation-sheet.tsx**: Pre-fill bug — `useState(initialGoalText)` only initialises at mount; added `useEffect` to sync `goalText` when the sheet re-opens with new `initialGoalText`.
- **App.tsx**: `activeProjectId` was being stored under key `"theme"`. Fixed to use key `"active_project"`.
- **commit.ts**: Once-jobs created with `fireAt: new Date()` were immediately past. Fixed with `ONCE_FIRE_BUFFER_MS = 10_000`.
- **App.tsx + runs-screen.tsx**: `run.created` and `run.statusChanged` event handlers were only registered in `RunsScreen`. When the user was on the Jobs screen, scheduled runs appeared as "Never" until navigating to Runs and back. Moved handlers to `App.tsx` (global, always-active) and removed duplicates from `RunsScreen`.


### Added
- Project scaffold: Tauri 2 + React 18 + TypeScript + Tailwind CSS 4
- Node.js agent sidecar with stdin/stdout IPC
- SQLite database with WAL mode (via better-sqlite3 + Drizzle ORM)
- Shared IPC type contract (`@openhelm/shared`)
- Ping/pong IPC round-trip proving end-to-end communication
- Settings table (key-value store) as initial schema

### Phase 1 — Data Layer & Core CRUD
- Full database schema: Projects, Goals, Jobs, Runs, RunLogs, Settings
- Drizzle ORM migration for all entity tables with cascade deletes
- Query layer with named functions per entity (`agent/src/db/queries/`)
- Schedule computation (once, interval, cron) with validation (`agent/src/scheduler/schedule.ts`)
- IPC handler layer with domain-specific handlers (`agent/src/ipc/handlers/`)
- Typed frontend API wrapper (`src/lib/api.ts`) for all CRUD operations
- Shared type contract expanded with all entity types and IPC method params
- 70 unit tests covering all queries, schedule logic, and cascade behaviour
- Debug panel in UI showing project list from real database

### Phase 2 — Claude Code Integration
- ClaudeCodeRunner (`agent/src/claude-code/runner.ts`) — sacred single module for spawning Claude Code CLI
  - Uses `-p --output-format stream-json` for headless streaming execution
  - Real-time output streaming via line-buffered stdout/stderr parsing
  - Timeout management with SIGTERM → SIGKILL escalation (5s grace period)
  - Cancellation support via AbortSignal
  - Configurable permission mode and budget limits
- CLI auto-detection (`agent/src/claude-code/detector.ts`)
  - Searches PATH (via `which`), Homebrew, and npm global install locations
  - Version detection and minimum version enforcement (v2.0.0+)
  - Persists detection results to settings table
  - Re-verifies stored path on startup, auto-re-detects if stale
- Interactive prompt detection (`agent/src/claude-code/interactive-detector.ts`)
  - Pattern matching for y/n prompts, password inputs, confirmation dialogs
  - Silence detection (60s configurable threshold)
  - Triggers callback instead of killing process (preserves partial work)
- Stream parser (`agent/src/claude-code/stream-parser.ts`)
  - Parses Claude Code `stream-json` output into human-readable log entries
  - Extracts text, tool use summaries, and result metadata (cost, duration, turns)
  - Truncates long tool results for log readability
- IPC emitter extracted to reusable module (`agent/src/ipc/emitter.ts`)
- IPC handlers for `claudeCode.detect`, `claudeCode.verify`, `claudeCode.getStatus`
- Frontend API wrappers for Claude Code detection operations
- Shared types: `ClaudeCodeDetectionResult`, `ClaudeCodeRunConfig`, `ClaudeCodeRunResult`
- New setting keys: `claude_code_version`, `run_timeout_minutes`
- Auto-detection runs on agent startup, emits `claudeCode.detected` event
- 42 new tests (112 total): detector, runner, interactive detector, stream parser

### Phase 3 — Scheduler & Executor
- In-memory priority queue (`agent/src/scheduler/queue.ts`)
  - Priority levels: 0=manual, 1=scheduled, 2=corrective
  - FIFO ordering within same priority level
  - Singleton instance shared between scheduler and executor
- Scheduler (`agent/src/scheduler/index.ts`)
  - 1-minute tick interval querying for due jobs (`nextFireAt <= now`)
  - Creates run records and enqueues them automatically
  - Updates `nextFireAt` after each enqueue (interval: completion+minutes, once: disable, cron: next future)
  - Callback-based notification to executor via `setOnWorkEnqueued`
- Executor (`agent/src/executor/index.ts`)
  - Worker pool consuming from priority queue
  - Configurable concurrency: default 1, max 3, via `max_concurrent_runs` setting
  - Full run lifecycle: pre-flight checks → mark running (DB before spawn) → ClaudeCodeRunner → completion
  - DB insert before IPC emit invariant for log ordering
  - Pre-flight checks: job existence, project directory existence, Claude Code path
  - `permanent_failure` status for unrecoverable pre-flight failures
- Crash recovery on agent startup
  - Stuck "running" runs → failed with explanatory log entry ("agent restart")
  - Orphaned "queued" runs → re-enqueued with correct priority
- Run status state machine enforcement (`agent/src/db/queries/runs.ts`)
  - Valid transitions enforced at query layer; invalid transitions throw errors
  - Terminal states (succeeded, failed, permanent_failure, cancelled) have no outgoing edges
- IPC handlers for `runs.trigger`, `runs.cancel`, `scheduler.status`
  - Manual trigger creates run with priority 0 (highest) for immediate execution
  - Cancel supports both queued (queue removal) and running (abort signal) runs
- Shared types: `TriggerRunParams`, `CancelRunParams`, `SchedulerStatus`
- Frontend API wrappers: `triggerRun()`, `cancelRun()`, `getSchedulerStatus()`
- Due job query: `listDueJobs()` and `disableJob()` added to jobs query layer
- 50 new tests (162 total): queue (10), state machine (13), scheduler tick (10), executor (17)

### Phase 4 — LLM Layer & AI Planning
- Custom LLM layer (`agent/src/llm/`)
  - `client.ts`: Thin Anthropic SDK wrapper with typed error hierarchy (`LlmError`)
    - Reads API key from settings table (not env vars)
    - Model tiers: `claude-sonnet-4-6` (planning), `claude-haiku-4-5-20251001` (classification)
    - Maps SDK errors to typed codes: missing_api_key, authentication_failed, rate_limited, etc.
  - `loop.ts`: Agent loop for tool-calling interactions
    - Configurable max iterations (default 3), safety-bounded execution
    - Accumulates token usage across all iterations
    - Handles single and parallel tool use in one response
  - `tools.ts`: Planning tool definitions and executors
    - `validate_cron_expression`: validates + returns next 3 human-readable occurrences
    - `get_current_datetime`: returns ISO, local, timezone, and day of week
- Planner module (`agent/src/planner/`)
  - `assess.ts`: Fast classification call to determine if goal needs clarification
    - Max 2 questions (hardcoded limit), multiple-choice with free-text option
    - Errs strongly on the side of NOT asking questions
  - `generate.ts`: Full agent loop producing structured job plans
    - Validates 2-6 jobs, each with name, description, prompt, rationale, schedule
    - Strips markdown fences from LLM output, validates schedule types
  - `commit.ts`: Atomic database transaction for plan commitment
    - Creates goal + all jobs in single transaction (all or nothing)
    - Once-jobs: `nextFireAt` set to now (fires within one scheduler tick)
    - Recurring jobs: `nextFireAt` computed forward from current time
  - `prompts.ts`: System prompts for assessment and plan generation
- IPC handlers: `planner.assess`, `planner.generate`, `planner.commit`
- Shared types: `AssessmentResult`, `ClarifyingQuestion`, `PlannedJob`, `GeneratedPlan`, `CommitPlanResult`, plus IPC param types
- 46 new tests (208 total): llm-client (5), llm-loop (7), llm-tools (8), planner-assess (9), planner-generate (10), planner-commit (7)

### Phase 5 — Core UI
- Design system and visual language (`src/styles/globals.css`)
  - Deep navy colour palette with warm amber accent
  - Tailwind CSS 4 theme tokens via `@theme inline`
  - Custom animations: `pulse-border` for running states, `pulse-dot` for sidebar indicators
  - Dark-themed scrollbar styling, monospace log viewer typography
  - `tw-animate-css` for shadcn/ui component transitions
- 17 shadcn/ui primitive components installed (button, input, textarea, label, badge, switch, select, sheet, dialog, card, separator, skeleton, scroll-area, dropdown-menu, radio-group, progress, tooltip)
- Application shell and navigation (`src/components/layout/`)
  - `AppShell`: fixed sidebar + main content layout
  - `Sidebar`: project selector dropdown, 4-item navigation (Goals, Jobs, Runs, Settings), live count badges with pulse animation for running runs
- Zustand stores (`src/stores/`)
  - `app-store`: page routing, navigation filters, active project, onboarding state, agent readiness
  - `project-store`: project CRUD with async fetching
  - `goal-store`: goal listing and status updates
  - `job-store`: job listing, enable/disable toggle, delete
  - `run-store`: run listing, manual trigger, cancel, real-time status updates
- Custom React hooks (`src/hooks/`)
  - `useAgentEvent`: subscribes to agent events via `CustomEvent` on `window`
  - `useRunLogs`: write-through buffer pattern for log streaming (100ms flush interval)
  - `useAutoScroll`: auto-scroll with user scroll detection and "Jump to latest" support
- Onboarding wizard (`src/components/onboarding/`)
  - 5-step flow: Welcome → Claude Code detection → API key → First project → Complete
  - Gates entire application until onboarding is complete
  - Auto-detection of Claude Code with manual path override
  - API key input with masked display and test functionality
  - Native directory picker via `@tauri-apps/plugin-dialog`
- Goals screen (`src/components/goals/goals-screen.tsx`)
  - Prominent goal input with example chips
  - Responsive goal card grid with status, job count, latest run, next fire time
  - Animated border on cards with running jobs
- Goal creation sheet (`src/components/goals/goal-creation-sheet.tsx`)
  - 4-step slide-over: Goal input → Clarification (conditional) → Plan review → Confirmation
  - Clarification step: radio chips with "Something else" free-text option
  - Plan review: editable job cards with name, prompt, schedule; add/delete jobs
  - Human-readable schedule display for all schedule types
  - Summary banner showing job counts and schedule breakdown
- Jobs screen (`src/components/jobs/`)
  - Table view with goal filter dropdown and show/hide disabled toggle
  - Columns: name, goal, schedule, enabled toggle, last run status, next fire time
  - Right-side detail panel with prompt, schedule, run now button, run history
  - "Run now" confirmation when a run is already in progress
- Runs screen (`src/components/runs/`)
  - Table view with job and status filter dropdowns
  - Real-time status updates via `run.statusChanged` events (no polling)
  - Trigger source labels (Scheduled / Manual / Corrective)
  - Right-side detail panel with status banner, cancel button, AI summary, log viewer
- Run status banner (`src/components/runs/run-status-banner.tsx`)
  - Full-width coloured banners: amber (running), green (succeeded), red (failed)
  - Live elapsed time counter updating every second for running runs
- Log viewer (`src/components/runs/log-viewer.tsx`)
  - Monospace display with stdout/stderr colour differentiation
  - Write-through buffer pattern: events buffered in `useRef`, flushed to state at 100ms intervals
  - Auto-scroll during live runs, pauses when user scrolls up
  - "Jump to latest" button appears when user scrolls up during live run
  - Search with highlight support
- Settings screen (`src/components/settings/settings-screen.tsx`)
  - Claude Code: detected path/version display, manual path override
  - Anthropic API: masked key display, change/add key
  - Execution: max concurrent runs (1-3), default timeout (10-120 minutes)
  - Application: version display, external links
- Shared components (`src/components/shared/`)
  - `RunStatusBadge` / `GoalStatusBadge`: coloured badges with icons for all statuses
  - `EmptyState`: icon + title + description + optional action
  - `LoadingSkeleton`: card, table row, and list skeleton variants
  - `NewProjectDialog`: project creation dialog for adding projects post-onboarding
- Utility functions (`src/lib/format.ts`)
  - `formatSchedule`: human-readable schedule descriptions for once/interval/cron
  - `formatRelativeTime`: relative time strings (just now, 5m ago, in 2h)
  - `formatDuration`: elapsed time formatting (<1s, 45s, 2m 5s, 1h 2m)
  - `getElapsed`: duration calculation between ISO dates
- Frontend API additions
  - Planner wrappers: `assessGoal()`, `generatePlan()`, `commitPlan()`
  - `projectId` filter added to `ListRunsParams` for project-scoped run queries
- Frontend test infrastructure
  - Vitest config with jsdom environment, React testing library
  - Tauri API mocks for testing without native runtime
  - 45 new tests (254 total): stores (10), format utils (20), hooks (3), components (12)

### Phase 6 — Real-Time Event Wiring
- (Completed previously — event bus, live log streaming, status updates)

### Phase 7 — Manual Job Creation
- Manual job creation sheet (`src/components/jobs/job-creation-sheet.tsx`)
  - Accessed via "New job" button on Jobs screen header
  - Fields: Name (required), Prompt (required, with char count), Goal association (optional dropdown of active goals), Schedule (Once/Interval/Cron with dynamic config fields), Working directory (defaults to project dir)
  - Prompt clarity check via LLM assessment on submit; shows inline clarification questions if needed
  - "Create anyway" escape hatch for users who know what they want
  - Appends clarification answers to prompt as additional context
  - Resets form state on close
- Prompt clarification component (`src/components/jobs/prompt-clarification.tsx`)
  - Inline display of 1-2 clarifying questions with radio chip options
  - "Other" free-text option for each question
  - Styled with primary accent border to draw attention
- Prompt assessment backend (`agent/src/planner/assess-prompt.ts`)
  - Uses classification model (Haiku) for fast assessment
  - Prompt-specific system prompt (softer than goal assessment — manual creation implies intentionality)
  - Max 2 questions, capped at 5 options each
  - IPC handler: `planner.assessPrompt`
- `workingDirectory` field added to Job entity
  - New nullable column in SQLite schema (migration `0002_icy_phil_sheldon.sql`)
  - Executor uses job's `workingDirectory` when set, falls back to project directory
  - Available in `CreateJobParams` and `UpdateJobParams`
- Job store `createJob` action — prepends new job to list
- Frontend API: `assessPrompt()` wrapper
- Shared types: `AssessPromptParams`, `PromptAssessmentResult`
- 37 new tests (291 total): prompt assessment (9), job store (4), creation sheet (6), clarification component (5), existing suites unchanged

### Phase 9 — Eliminate Anthropic API Key
- Removed `@anthropic-ai/sdk` dependency entirely
- All internal LLM calls (planning, assessment, summarisation) now route through Claude Code CLI in `--print` mode
  - New `agent/src/claude-code/print.ts`: lightweight CLI wrapper for single-turn completions
  - New `agent/src/planner/llm-via-cli.ts`: adapter translating planner needs into CLI calls
  - New `agent/src/planner/cron-validator.ts`: standalone cron validation utility
- Users no longer need a separate Anthropic API key — only a Claude Code subscription
- Removed `anthropic_api_key` from `SettingKey` union type
- Removed API key step from onboarding wizard (5 steps → 4 steps)
- Removed API key section from settings screen
- Deleted `agent/src/llm/` directory (client.ts, loop.ts, tools.ts, index.ts)
- Deleted `src/components/onboarding/steps/api-key-step.tsx`
- IPC error handling updated: `PrintError` replaces `LlmError`
- Datetime context now inlined in plan generation prompt (replaces `get_current_datetime` tool)
- Post-generation cron validation replaces `validate_cron_expression` tool
- One-time cleanup on agent startup removes any stored legacy API key
- Model selection: `sonnet` alias for planning, `claude-haiku-4-5-20251001` for classification
- 16 new/rewritten tests, 20 tests deleted (net: 234 agent tests, down from 254 due to removed LLM layer tests)

### Phase 8 — Polish, Hardening & Distribution

#### 8.1 Comprehensive Error Handling
- Typed LLM error propagation through IPC (`agent/src/ipc/handler.ts`)
  - `LlmError` instances mapped to dedicated IPC error code `-32001` with human-readable messages
  - Per-code user-friendly messages: missing_api_key, authentication_failed, rate_limited, overloaded, network_error, timeout, invalid_request, unknown
- Executor preflight checks enhanced (`agent/src/executor/index.ts`)
  - Claude Code binary existence check via `existsSync` (not just config presence)
  - Actionable messages for missing CLI path, missing binary, missing project directory
  - All preflight failures produce `permanent_failure` with clear guidance
- Database initialization error handling (`agent/src/db/init.ts`)
  - `SQLITE_FULL` caught and surfaced as "Your disk may be full"
  - Generic init failures include database path in error message
- Malformed LLM response retry (`agent/src/planner/assess.ts`, `agent/src/planner/generate.ts`)
  - Single automatic retry on JSON parse failures before surfacing error
  - Console logging on retry for debugging
- Agent crash handlers (`agent/src/index.ts`)
  - `uncaughtException` and `unhandledRejection` handlers emit `agent.error` event before exit
- Frontend `friendlyError` utility (`src/lib/utils.ts`)
  - Extracts human-readable messages from JSON-RPC errors, timeout errors, and raw exceptions
  - Used in all Zustand store catch blocks (goal, job, run stores)
- Reusable `ErrorBanner` component (`src/components/shared/error-banner.tsx`)
  - AlertTriangle icon, message, optional Retry and Dismiss buttons
- Agent timeout detection in `App.tsx`
  - 15-second timeout on agent readiness with error UI and Restart button (`relaunch_app` Tauri command)
- 22 new tests: IPC error mapping (7), friendlyError utility (7), ErrorBanner component (8)

#### 8.2 Empty States
- Goals screen: descriptive guidance text directing users to type their first goal
- Jobs screen: dual empty states — no jobs at all (with "Set a goal" + "Create job" action buttons) vs. filtered to empty (filter-specific message)
- Runs screen: dynamic empty description showing next scheduled run time when jobs with `nextFireAt` exist
- Run detail panel: summary section for running state ("Summary will appear when the run completes.") and terminal with no summary ("Summary unavailable.")

#### 8.3 Performance — Virtualized Log Viewer
- Log viewer rewritten with virtual scrolling (`src/components/runs/log-viewer.tsx`)
  - Only renders visible lines plus overscan buffer (~60-80 DOM nodes regardless of total log count)
  - Constants: `LINE_HEIGHT = 20px`, `OVERSCAN = 20 lines`, `BOTTOM_THRESHOLD = 30px`
  - `ResizeObserver` for responsive container height tracking
  - Auto-scroll tracking via `wasAtBottomRef` — pauses when user scrolls up, resumes at bottom
  - "Jump to latest" button when user is scrolled up during live run
  - Handles 10,000+ log lines without freezing or scroll jank

#### 8.4 macOS Integration
- Dock behaviour: hide-on-close via `on_window_event` handler in `lib.rs`
  - `CloseRequested` → `api.prevent_close()` + `window.hide()` — agent keeps running in background
  - macOS "Quit" menu item still terminates the app normally
- Launch at login: `tauri-plugin-autostart` with `MacosLauncher::LaunchAgent`
  - Toggle in Settings screen under Application section
  - Invokes `plugin:autostart|enable` / `plugin:autostart|disable` via Tauri invoke
- Notification permission: requested on first launch via `tauri-plugin-notification`
  - Checks `notification_permission_requested` setting to avoid repeat prompts
  - Requests permission early (not at notification time) per macOS UX best practice
- Native file picker: `tauri-plugin-dialog` registered for directory selection throughout the app
- `relaunch_app` Tauri command added for restart functionality
- Rust plugins added to `Cargo.toml`: `tauri-plugin-autostart`, `tauri-plugin-notification`, `tauri-plugin-dialog`, `tauri-plugin-updater`
- Capabilities updated with permissions for all four plugins
- `macOSPrivateApi` enabled in `tauri.conf.json` for dock behaviour support

#### 8.5 Build Pipeline & Distribution
- GitHub Actions release workflow (`.github/workflows/release.yml`)
  - Triggers on `v*` tag push, builds on `macos-latest` (Apple Silicon)
  - Installs Node 20, Rust stable (aarch64 + x86_64 targets), npm dependencies
  - Builds agent sidecar and copies to `src-tauri/binaries/` with Tauri target-triple naming
  - Imports Apple Developer certificate for code signing (optional, via secrets)
  - Uses `tauri-apps/tauri-action@v0` for build, sign, notarize, and GitHub Release creation
  - Attaches DMG and `latest.json` updater manifest to release
  - Secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- GitHub Actions CI workflow (`.github/workflows/ci.yml`)
  - Runs on PRs to main and pushes to main
  - `lint-and-test` job: TypeScript type-check, ESLint, full test suite
  - `build-check` job: agent sidecar build + Rust `cargo check` compilation verification
  - Concurrency groups cancel in-progress runs for same branch/PR
- Tauri auto-updater integration
  - `tauri-plugin-updater = "2"` added to Rust dependencies
  - Plugin registered in `lib.rs` via `.plugin(tauri_plugin_updater::Builder::new().build())`
  - Updater configured in `tauri.conf.json` plugins section with GitHub Releases endpoint
  - `updater:default` permission added to default capabilities
- 24 new tests (315 total): IPC error mapping (7), friendlyError (7), ErrorBanner (8), executor preflight (1), planner retry fixes (1)

### End-to-End Verification Bug Fixes

#### Live Log Streaming (Critical)
- Fixed `RunLogEvent` interface mismatch in `src/hooks/use-run-logs.ts`
  - Agent emits individual events `{runId, sequence, stream, text}` but handler expected `{runId, logs: Array<...>}`, causing `data.logs.map is not a function` TypeError on every log event
  - Corrected interface to match single-line agent emission; log streaming now works correctly

#### Scheduled Runs Not Appearing in UI
- Fixed missing `run.created` event emission in `agent/src/scheduler/index.ts`
  - Scheduler only emitted `run.statusChanged` but the runs screen listens for `run.created` to refresh the list; scheduled runs were invisible until manual page refresh
- Applied same fix to manual trigger handler in `agent/src/ipc/handlers/scheduler.ts`

#### Run Duration Always Showing "< 1s"
- Fixed `run.statusChanged` events missing timing fields in `agent/src/executor/index.ts`
  - Running transition now includes `startedAt` in the event payload
  - Terminal transition now includes `finishedAt` and `exitCode` in the event payload
- Updated `handleStatusChange` in `src/components/runs/runs-screen.tsx` to apply all timing fields from events to the in-memory run store (conditional spread prevents null/undefined overwrites)

#### Active Project Not Restored After Restart
- Fixed `App.tsx` to actually use the saved project ID when restoring the active project
  - Previously loaded the `theme` setting but ignored its value, always selecting `projectsList[0]`
  - Now correctly selects the saved project or falls back to first available

#### `permanent_failure` Not Filterable in Runs Screen
- Added missing `permanent_failure` option to `STATUS_OPTIONS` in `src/components/runs/runs-screen.tsx`

#### Settings: No Way to Set Claude Code Path When Not Detected
- Fixed `ClaudeCodeSection` in `src/components/settings/settings-screen.tsx`
  - "Change path" input was only accessible when Claude Code was already found (the toggle button was inside the "detected" branch only)
  - Added "Set path manually" button and install instructions to the "not detected" branch so users can configure the path after onboarding

#### TypeScript: null/undefined Mismatch in Executor
- Fixed `agent/src/executor/index.ts` — `updateRun` call passed `number | null` for `exitCode` and `string | null` for `summary`, but `UpdateRunParams` declares these as `number | undefined` and `string | undefined`
  - Added `?? undefined` coercions to both fields at the call site

### End-to-End Verification — Round 2 Bug Fixes

#### Critical: Goal Creation Sheet Shows Blank Screen When No Clarification Needed
- Fixed `src/components/goals/goal-creation-sheet.tsx`
  - When `assessGoal` returned `needsClarification: false`, the sheet jumped to step 2 but `plan` was still `null`, so `{step === 2 && plan && <PlanReviewStep />}` never rendered — completely blank content area
  - Fix: added `doGeneratePlan()` helper that auto-generates the plan when skipping clarification; step 2 now shows a spinner while generating, an `ErrorBanner` with retry on failure, and `PlanReviewStep` when ready

#### Critical: Once-Jobs Committed via `commitPlan` Never Fire
- Fixed `agent/src/planner/commit.ts`
  - `adjustScheduleConfig` set `fireAt: new Date().toISOString()`, but by the time `createJob` calls `computeNextFireAt(scheduleType, config, new Date())` (a few ms later), `fireAt` is already in the past → `computeNextFireAt` returns `null` → `nextFireAt = null` → scheduler never picks up the job
  - Fix: added `ONCE_FIRE_BUFFER_MS = 10_000` — `fireAt` is now set 10 seconds in the future, ensuring it's still in the future when `createJob` processes it; the job fires on the next scheduler tick (≤ 60s)
  - Added test assertion: `job.nextFireAt` must be non-null for once-jobs created via `commitPlan`

#### Misleading Settings Key for Active Project
- Fixed `App.tsx`: active project ID was stored and read under settings key `"theme"` — renamed to `"active_project"`
  - Added `"active_project"` to `SettingKey` type in `shared/src/index.ts`
  - `"theme"` key retained in the union type for forwards compatibility
