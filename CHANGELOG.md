# Changelog

## [1.0.0] - 2026-04-14

### Added
- **Voice Chat (Local Mode)** — Plan 13a: full bidirectional voice chat using a local STT→LLM→TTS pipeline
  - `agent/src/voice/` module: VoiceSession orchestrator, VAD silence detection, sentence splitter for streaming TTS, Whisper STT via `smart-whisper`, Piper TTS subprocess manager, audio utilities
  - Frontend: `VoiceButton`, `VoiceWaveform`, `VoiceSettings` components; `voice-store` Zustand store; `AudioCapture` and `AudioPlayback` utilities
  - Mic button added to ChatInput and InboxInput
  - New onboarding step 6 (Voice Project Setup): conversational voice-based project setup during onboarding
  - Microphone permission row added to onboarding Permissions step
  - IPC: `voice.start`, `voice.audioChunk`, `voice.stop`, `voice.cancel`, `voice.approve`, `voice.getSettings`, `voice.updateSettings`
  - Events: `voice.status`, `voice.transcript`, `voice.ttsChunk`, `voice.actionPending`, `voice.error`
  - Whisper model pre-warm at startup (non-blocking, skips if voice disabled)
  - Provider abstraction designed for future Plan 13b Cloud voice (OpenAI Realtime)
  - TTS engine selector: Piper (default, ships with app), Kokoro, Coqui XTTS v2 (Phase 3)
  - Conversation mode (VAD-triggered) and push-to-talk mode
  - Barge-in: speaking during TTS playback interrupts immediately
  - Voice-optimized onboarding system prompt variant

### Fixed
- **Cloud demo mode: projects selector isolation, transient blank pages, scheduler demo-job execution (2026-04-14)**: Three demo-mode bugs fixed in one pass. (a) **Projects selector isolation**: `projects.list` in `transport-supabase-crud.ts` now filters `.eq("is_demo", false)` so real cloud users never see demo projects mixed into their sidebar and demo visitors can't navigate between demos via the dropdown. `DemoRoute` now seeds `useProjectStore` directly with the resolved demo project (so the sidebar still shows the demo's name) and `App.tsx` skips `fetchProjects()` when `useDemoStore.getState().isDemo` is true so the subsequent list call doesn't wipe the seeded state. (b) **Transient blank pages on Dashboard / Memory**: root cause was `AnimatePresence mode="wait"` wedging when the Dashboard's motion.div key flipped rapidly between `"welcome"` and `"dashboard"` as `useGoalStore.fetchGoals` resolved during initial load. A wedged `AnimatePresence` child breaks all subsequent navigation (including to Memory) until a full page reload. Fix: stabilised the dashboard key to the constant `"dashboard"` and moved the welcome-vs-dashboard decision inside the motion.div. Also disabled `showWelcome` entirely in demo mode since demo projects always have seeded goals — eliminates any chance of the flip re-occurring for demo visitors. (c) **Scheduler executing demo jobs**: the cloud `worker/src/scheduler.ts` `tick()` query was picking up demo jobs (seeded with `is_enabled=true` cron schedules for display purposes only) and attempting to run them via Claude Code against the demo owner user, which has no real credentials — producing a flood of failed runs in the demo dashboard. Fix: added a PostgREST inner-join filter `projects!inner(is_demo)` + `.eq("projects.is_demo", false)` to the due-jobs query so demo jobs are never enqueued. New migration `20260414000004_demo_runs_cleanup.sql` deletes the stray non-seed runs already sitting in the production DB (keyed off the `demo-<slug>-run-N` seed id convention). Demo seed migrations (`demos/20260414000100_demo_nike.sql`, `demos/20260414000101_demo_taylor_wessing.sql`) updated to also refresh `created_at` in their run ON CONFLICT clauses so `scripts/reset-demo.sh <slug>` genuinely restores fresh timestamps instead of leaving historical rows stale. New integration test `skips jobs belonging to demo projects` in `worker/src/__tests__/integration.test.ts` covers the scheduler fix. All 427 frontend + 16 worker tests pass; typecheck clean. **TO STILL TEST (manual, cloud-only)**: (1) re-run both demo seed migrations against the production Supabase project via `scripts/reset-demo.sh nike` and `scripts/reset-demo.sh taylor-wessing` to refresh timestamps; (2) confirm `/demo/nike` and `/demo/taylor-wessing` load with the dashboard populated and the projects selector showing only that demo; (3) sign in as a real cloud user and confirm demo projects no longer appear in the sidebar dropdown; (4) confirm over the next 24h no new failed runs appear in demo dashboards.
- **Stealth browser Round 11 — Runtime.enable elimination, Sec-CH-UA HTTP header alignment, Function.prototype.toString cloak, force-open shadow DOM, document.visibilityState, canvas getImageData noise, 5 new Chrome args, triple_click MCP tool (2026-04-13, 29 failed runs in the prior 24-hour window)**: After overnight log analysis showed 29/41 (71%) prod runs failing — dominated by X.com Cloudflare Turnstile, Reddit Snoosheriff blank-page detection, Quora Cloudflare, and Discord post-login blocks — Round 11 ships the 2026-era stealth fixes that Round 10 didn't reach. **The single biggest change**: eliminated the two `uc.cdp.runtime.enable()` callsites in `cdp_function_executor.py` and `cdp_element_cloner.py`. Holding the CDP Runtime domain open is the #1 detection vector in 2026 — patchright, rebrowser-patches, ZenDriver, and camoufox all converge on this fix. nodriver's `tab.send(uc.cdp.runtime.evaluate(...))` works without it because Chrome maintains an implicit main-world execution context per frame from page commit. (a) **A.1 Runtime.enable elimination**: `enable_runtime` is now a no-op (preserved for backwards compat with every callsite); element cloner uses only DOM/CSS/DOMDebugger domains (all safe). (b) **A.2 Sec-CH-UA HTTP header alignment**: new `_brand_profile()` helper in `stealth.py` is the single source of truth for both the JS-side `userAgentData` spoof (Patch 8 in `stealth_core.js`) AND the HTTP `Sec-CH-UA / Sec-CH-UA-Mobile / Sec-CH-UA-Platform / Sec-CH-UA-Full-Version-List / Sec-CH-UA-Platform-Version / Sec-CH-UA-Arch / Sec-CH-UA-Bitness / Sec-CH-UA-Model` headers set via `Network.setExtraHTTPHeaders`. Closes the "Franken-fingerprint" Reddit's Snoosheriff and Cloudflare cross-check between JS and HTTP. The script loader substitutes `__OH_BRAND_LIST__` / `__OH_CHROME_MAJOR__` / `__OH_CHROME_FULL__` / `__OH_PLATFORM_NAME__` placeholders into the JS bundle from the same `_brand_profile()` call, so JS and HTTP cannot disagree. `stealth_webgpu.js` Patch 25 (which had a hardcoded `'136'` conflicting with the new pipeline) was reduced to a comment-only no-op. (c) **A.3 Patch 30: `Function.prototype.toString` global cloak**: `__oh_patched = new WeakSet()` plus a `Function.prototype.toString` override that returns `[native code]` for any registered function, exposed via `window.__oh_register(fn)` for subsequent patches to call. Replaces the per-function `.toString` shims that the canonical `Function.prototype.toString.call(fn)` probe bypassed. Self-registers `Function.prototype.toString` itself so the cloak hides itself. (d) **A.4 Patch 31: force-open `attachShadow` + shadow DOM walker**: overrides `Element.prototype.attachShadow` to set `init.mode = 'open'` regardless of input, so Cloudflare Turnstile's closed shadow DOM becomes reachable to CDP. Installs a `MutationObserver` walking newly-added subtrees for shadow roots. **Caveat**: this enables FINDING and CLICKING the Turnstile checkbox, but Turnstile's behavioural ML scoring (mouse path / attention timing) still applies — `request_user_help` remains the documented fallback for interactive Turnstile, and the preamble (Section C.2) now enforces it as the first escalation. (e) **A.5 Patch 32 (visibilityState always 'visible') + Patch 33 (canvas `getImageData` noise)**: Patch 32 defines getters on `Document.prototype.hidden` / `visibilityState` / `webkitVisibilityState` / `webkitHidden` so they unconditionally report `false` / `'visible'` (closes the Cloudflare interstitial-time leak). Patch 33 extends `stealth_fingerprint.js`'s existing canvas noise (which only covered `toDataURL` / `toBlob`) to ALSO override `CanvasRenderingContext2D.prototype.getImageData` — Cloudflare Turnstile reads canvas pixels directly via `getImageData`, NOT via `toDataURL`. Same per-session deterministic XOR noise from `__stealthHash`. (f) **A.6 5 new Chrome args**: `--no-first-run`, `--no-default-browser-check`, `--disable-default-apps`, `--password-store=basic`, `--use-mock-keychain`. Suppresses first-run experience signals and Mac/Windows password-manager prompts that real interactive Chrome users would have already configured around. (g) **C.1 Notion `page_size ≤25` + Sentry OR/AND quirks documented in `EXTERNAL_MCP_GUIDANCE`**: prevents the wasted-call patterns observed in tonight's runs (`f84bab15`, `87026723`, `73508ece`). (h) **C.2 `BROWSER_CAPTCHA_PREAMBLE` Cloudflare escalation**: explicit "CLOUDFLARE INTERACTIVE CHALLENGES" subsection naming X.com / Quora / Discord and prescribing `request_user_help` as the FIRST escalation, with a 15-minute polling budget. Calls out abandoning a Cloudflare-blocked run after 30 seconds without `request_user_help` as a job failure the agent is responsible for. (i) **B.2 `BROWSER_PROFILE_PREAMBLE` cross-compaction enforcement**: NEVER trust a browser instance UUID from a conversation-summary header; ALWAYS call `list_instances` first to get the live UUID set; discard summary-derived UUIDs that aren't in the live set. (j) **D.1 `triple_click` MCP tool**: new `DOMHandler.triple_click(tab, selector, text_match, timeout)` method exposed as a section-element-interaction MCP tool. Reuses `_find_element_robust` for selector resolution, computes element centre via `element.get_position()` with a JS `getBoundingClientRect()` fallback, dispatches three `mousePressed` + `mouseReleased` pairs at the centre via CDP `Input.dispatchMouseEvent` with `clickCount` going `1 → 2 → 3`. Spacing 50ms — fast enough for Chrome's click-count accumulator (`DBLCLK_TIME_MS` ~500ms) to treat them as one gesture. Absorbs the `mcp__openhelm_browser__triple_click` hallucination from run `f84bab15` rather than fighting it. (k) **22 new source-level tests** in `agent/mcp-servers/browser/tests/test_stealth_round11.py` covering every patch (Runtime.enable elimination, Sec-CH-UA alignment, Patch 30/31/32/33 presence and behaviour, Chrome args, triple_click signature). 5 new TS tests in `agent/test/mcp-config-builder.test.ts` covering the new preamble bullets. **Realistic outcome**: 70-90% bypass rate for Cloudflare interstitials on residential IPs (Quora, X.com initial); Reddit blank-page detection probably solved by the Sec-CH-UA alignment per rebrowser community reports; Cloudflare Turnstile interactive checkbox still requires `request_user_help` for the behavioural ML scoring layer (Round 12 territory: OS-level mouse event injection via Tauri Rust sidecar). All 970 agent tests + 164 browser tests pass. Files: `agent/mcp-servers/browser/src/cdp_function_executor.py`, `agent/mcp-servers/browser/src/cdp_element_cloner.py`, `agent/mcp-servers/browser/src/stealth.py`, `agent/mcp-servers/browser/src/dom_handler.py`, `agent/mcp-servers/browser/src/server.py`, `agent/mcp-servers/browser/src/js/stealth_core.js`, `agent/mcp-servers/browser/src/js/stealth_fingerprint.js`, `agent/mcp-servers/browser/src/js/stealth_webgpu.js`, `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/mcp-servers/browser/tests/test_stealth_round11.py` (NEW), `agent/test/mcp-config-builder.test.ts`, `docs/browser/efficiency-improvements.md`, plus byte-identical mirrors under `src-tauri/mcp-servers/browser/src/` and `src-tauri/mcp-servers/browser/tests/`.

### Externalised (Round 11 — user action required, NOT code-patched per "Externalize Fixes" rule)
- **HN `comment-toofast` rate-limit collisions**: User opted to fix this externally by manually adjusting the schedule cadence of HN-touching jobs (`Hacker News Engagement`, `Hacker News — Reply to comment notifications`, `Community Engagement Publisher`, `OpenClaw Discussion Finder`) so submissions are spaced ≥20 minutes apart. The generic platform-cooldown system originally proposed in the Round 11 plan was descoped per user request.
- **OpenHelm Sentry MCP missing for `OpenHelm Sentry Error Fixer` job (run `1a7f2f55`)**: Add the Sentry MCP server to OpenHelm's project-level `.mcp.json`. The other Sentry Error Fixer job (`81b7edad`) succeeded 46 seconds later because it lives in a project that has Sentry MCP configured. No OpenHelm code change needed.
- **Stale Community Engagement Publisher queue (run `9621e87d`, all 5 URLs were 404s)**: Update Community Post Discovery job prompt to verify URLs with a HEAD request before adding to queue. Update Community Engagement Publisher prompt to mark URLs as `status='dead'` when 404d so they're not retried.
- **OpenClaw DM Outreach expired session, no recovery (run `031492fa`)**: Update job prompt: "if `check_session` returns `logged_in: false`, call `auto_login` with stored credentials BEFORE deciding the task is blocked." The capability already exists; the agent isn't using it.
- **Engagement w/ store owners visited 1 of 40 contacts then stopped (run `87026723`, exit 143)**: Update job prompt: "ITERATE THROUGH ALL N CONTACTS. Stop only when (a) all are processed, (b) you hit 5 consecutive failures, or (c) you have <10% context budget remaining. NEVER stop after a single success or failure."
- **Dream 100 Discovery LinkedIn invite iframe sandbox (run `772cf846`)**: Inherent platform limitation — LinkedIn invite modal is in a same-origin sandboxed iframe CDP can't navigate into. Workaround: send invites manually OR via LinkedIn Sales Navigator API.
- **OpenClaw Discussion Finder off-target HN threads (run `74132076`)**: Update job prompt: "Before commenting on a thread, verify the thread title or top-level body contains 'OpenClaw' or 'Anthropic ban' or 'Claude Code subscription'. NEVER comment on tangentially-relevant AI/LLM threads to fill quota."
- **OpenClaw HN low-karma rate limiting (run `2cca2828`)**: Account-level constraint. Use a different HN account with 50+ karma.
- **Reddit SEO Comments incomplete scope (run `df1e3a83`, 4 of 5 threads)**: Update prompt to require all 5 threads attempted with explicit per-thread success verification.
- **Blog Content Creation `npm run test` script missing (run `e39f9a60`)**: Add a `test` script to the blog project's `package.json` (even `echo "no tests"`), OR remove the test step from the job prompt.

- **Reddit DM composer / LinkedIn message composer / Reddit old-login shadow DOM — 5-step paste ladder, React native setter, shadow-DOM pierce (Round 10, 2026-04-12, Patterns 1/7/9, 14 runs)**: Overnight log analysis found 14 runs failing on framework-guarded input fields. Reddit's DM composer uses Lexical, which ignores `document.execCommand('insertText')` and the CDP `Input.insertText` fallback — the field stays empty despite both calls returning "success" (Pattern 1, 11 runs). LinkedIn's message composer is a React 18-controlled `<textarea>` — DOM value assignment and event simulation silently do nothing because React's value tracker sees no prototype-level change (Pattern 9, 2 runs). Reddit's old-login form lives inside an `<auth-flow-modal>` shadow root, which `document.querySelectorAll` can't pierce (Pattern 7, 1 run). Fix: (a) `_paste_into_contenteditable_ladder` replaces the old 2-step paste with a 5-step cascade (execCommand → InputEvent(beforeinput+input) → ClipboardEvent(paste) with DataTransfer → CDP Input.insertText → keyboard Cmd/Ctrl+V), verifying via read-back after each step and exiting early on first success. (b) `_react_native_setter_paste` detects React Fiber-controlled inputs via `__reactFiber*` property scan and uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)` — the well-known native-setter trick that bypasses React's value tracker. Both `paste_text` and `type_text` now fall through to it when the primary path leaves the field empty. (c) A global `window.__ohFind` / `window.__ohFindAll` helper is installed lazily on every paste/type/resolve flow. It walks open shadow roots (capped at 1000 roots / 1.5s budget). The resolver's candidate scan, `_read_field_value`, `_is_contenteditable`, `_clear_contenteditable`, and every paste-ladder step use it, so shadow-hosted inputs are handled transparently. For shadow-hosted targets, `paste_text` skips `tab.select()` (nodriver's native-handle path can't pierce shadow boundaries) and does focus/clear via JS. The verification dict gains `method_used` (naming which technique landed the text) and `is_shadow_hosted` fields. Rule D in `BROWSER_MCP_PREAMBLE` documents the ladder and `method_used`; rule G (LinkedIn) is relaxed from "Lexical ignores everything, STOP" to "look for `method_used: react_native_setter`". Mirrored to `src-tauri/mcp-servers/browser/src/`. Files: `agent/mcp-servers/browser/src/dom_handler.py`, `agent/src/mcp-servers/mcp-config-builder.ts`, `src-tauri/mcp-servers/browser/src/dom_handler.py`.
- **Stealth browser 2026 detection-landscape hardening — 4 new patches (26-29) + Chrome args (Round 10, 2026-04-12, Patterns 2/4/6)**: Existing 25 stealth patches cover JS-layer fingerprints but not behavioural/network-layer signals. Overnight analysis showed 10 X.com Cloudflare failures, 6 Reddit CDP "Prove your humanity" failures, and 4 Discord post-login blanks. New `js/stealth_behavioral.js` adds: **(26) WebRTC STUN IP leak prevention** — overrides `RTCPeerConnection.createOffer` / `createAnswer` to strip `typ host` SDP candidates, blocking the local-IP leakage path fingerprinters use to detect CDP-driven Chrome even when traffic is proxied. **(27) `navigator.getGamepads()` normalisation** — returns `[null, null, null, null]` (common desktop shape) if the API is absent (headless-ish Chrome quirk). **(28) Battery API mock** — `navigator.getBattery()` returns a plausible mock BatteryManager if missing (fingerprinters flag absent Battery API as bot-ish). **(29) `Permissions.query` hardening** — extends the existing notifications normalisation (patch 5) to cover clipboard-read/write, midi, geolocation, camera, microphone, push, persistent-storage, background-sync — each returns a default-install Chrome response, never the headless/CDP default-denied response. Chrome launch args gain `--use-fake-ui-for-media-stream`, `--disable-features=AutomationControlled` (belt-and-braces with existing `--disable-blink-features`), `--disable-extensions-except=`, and `--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter`. None of these patches are site-specific — they close generic fingerprint-probe gaps. NOT included: JA4/TLS fingerprinting (transport-layer, requires proxy infrastructure — Phase 3 in stealth R&D memory); nodriver's `Runtime.enable` replacement (requires patching nodriver itself). Files: `agent/mcp-servers/browser/src/js/stealth_behavioral.js` (NEW), `agent/mcp-servers/browser/src/stealth.py`, `src-tauri/mcp-servers/browser/src/js/stealth_behavioral.js`, `src-tauri/mcp-servers/browser/src/stealth.py`.
- **Silence-timeout SIGTERMs a completed run on its final summary message (Round 10, 2026-04-12, Pattern 10)**: Run `fcbe8674` completed 3 SEO blog posts, deployed them to Vercel, verified them live on production, emitted a "✅ Task Complete" message — and was then killed by the 600s silence watchdog after going quiet while the process wound down. Exit code 143 (SIGTERM), status marked failed. `InteractiveDetector.processLine` only recorded the last 10 lines for the error message; it never inspected them for a completion signal. Fix: `processLine` now scans for a completion-signal regex (`Task Complete`, `Run Status: SUCCESS`, `## Summary`, `All Done`, etc.). On match, it reduces the silence window to a 30s tail window and, when the timer fires, calls `onNaturalCompletion(reason)` instead of `onDetected('silence_timeout')`. The runner gracefully terminates, marks `result.naturalCompletion = true`, and the executor's `onRunCompleted` routes natural-completion exits through the outcome-assessment path (same as exit 0), marking them as succeeded — not hitl-killed. Files: `agent/src/claude-code/interactive-detector.ts`, `agent/src/claude-code/runner.ts`, `agent/src/executor/index.ts`, `shared/src/index.ts`.
- **Phantom MCP server marks successful Dream 100 run as failed (Round 10, 2026-04-12, Pattern 14)**: Run `087e62fe` completed its core work (3 podcast hosts added to Notion Dream 100 database, LinkedIn invites sent) but the executor marked it failed because Claude at one point hallucinated a `mcp__WebSearch__*` tool call. WebSearch is a BUILT-IN Claude tool, not an MCP server — the error log matches the `hasMcpToolMissingError` regex but there is no actual server to auto-retry. The round-6 auto-retry then wasted a full run reproducing the same hallucination. Fix: `writeMcpConfigFile` now returns `{path, serverNames}` instead of just `path`, and `findUnrecoveredMcpServers` accepts an optional `configuredServers` parameter that filters out server names not in the actual config (the phantom `WebSearch` entry is silently dropped). Both executor call sites thread `configuredMcpServers` through. Legitimate `mcp__openhelm_browser__*` failures still trigger the retry path. Files: `agent/src/db/queries/run-logs.ts`, `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/src/executor/index.ts`.
- **`data_table_rows` NOT NULL constraint on raw sqlite3 agent writes (Round 10, 2026-04-12, Pattern 12)**: OpenClaw Discussion Finder's tracker writes were silently failing every run with `Runtime error near line 1: NOT NULL constraint failed: data_table_rows.id (19)`. Agents using the Bash tool to INSERT engagement rows via raw `sqlite3` CLI bypass Drizzle's `$defaultFn` (which runs at the application layer), so the SQL-level NOT NULL on `id`/`updated_at` fires. Fix: new migration `0042_data_table_rows_defaults.sql` adds a `data_table_rows_autofill` view with an INSTEAD OF INSERT trigger that auto-fills missing `id` (pseudo-UUID via `hex(randomblob(16))` matching Drizzle's shape), `created_at`, and `updated_at`. Agents should INSERT into the view when using raw sqlite3; the real table still requires explicit values (intentional — loud errors beat silent drops). The data-tables prompt preamble now directs agents to (1) prefer `openhelm_data` MCP tools, (2) fall back to the `_autofill` view if raw sqlite3 is unavoidable, (3) never INSERT into `data_table_rows` directly without supplying `id`. Files: `agent/src/db/migrations/0042_data_table_rows_defaults.sql` (NEW), `agent/src/db/migrations-data.ts`, `agent/src/db/schema.ts`, `agent/src/data-tables/prompt-builder.ts`.

### Externalised (user action required — not code-patched, per "Externalize Fixes" rule)
- **HN `comment-toofast` (9 failed runs, Pattern 3)**: HN enforces an account-wide rate limit on comment submissions that the existing jobs (HN Engagement, Community Engagement Publisher, OpenClaw Discussion Finder) run afoul of. Reschedule those jobs so HN submissions are ≥24h apart — edit each job's `schedule_config` in the UI. The agent-side detection and graceful-stop logic (Issue 8 in CHANGELOG 2026-04-11) is already in place; this is purely a schedule-cadence problem.
- **Reddit `reddit_session` cookie missing (5 failed runs, Pattern 5)**: `available_credentials: []` means the credential store has no Reddit entry. Re-authenticate the Reddit browser profile via the credentials UI.
- **OpenClaw DM Outreach searches for `~/.openhelm/reddit-config.json` (1 run, Pattern 8)**: The job's own prompt references a config-file path that shouldn't exist. Update the prompt to remove the config-file fallback and reference the browser-profile flow.
- **Discord + Quora missing pre-auth (2 Launch posts runs, Pattern 15)**: Add browser profiles for both platforms via the credentials UI before those jobs can run.
- **Reddit Reply — element selector premature abandonment (1 run, Pattern 16)**: The agent gave up after one failed `find_by_role` call. Update the "Reddit — Reply to notifications & DMs" job prompt to explicitly instruct retrying with `find_on_page('Reply')` and scrolling candidates into view before abandoning.
- **Context compaction "TEXT ONLY" prompt blocks mid-modal tool use (2 runs, Pattern 13)**: This is a Claude Code CLI behaviour (injected during the built-in `/compact` flow), not OpenHelm-owned. Split large engagement jobs (e.g. "Engagement with prospective store owners", 19 targets) into smaller per-batch runs so compaction doesn't fire mid-task.
- **Reddit comment silently not posted (1 run, Pattern 17)**: Likely a shadow-ban on the account. Verify the Reddit account's reputation/karma and consider warming it up with organic posts before continuing automation.

- **Job prompt lost in preamble noise — Claude reports "no specific task was provided"**: In runs with many browser credentials, memories, and data tables injected, the actual job prompt (~140 chars) was buried unmarked inside an assembled user message totalling 15,000+ chars of preamble and context. Claude could not identify the user task inside the undifferentiated blob, so it responded asking for a task instead of executing. Fix: the fresh-run path in the executor now wraps `job.prompt` in `===== TASK (execute now) ===== … ===== END TASK =====` delimiters so the task is unmissable regardless of how much surrounding context is injected. Files: `agent/src/executor/index.ts:477`, `agent/test/executor.test.ts`.
- **JSON.parse error handling in data table tool execution**: Four JSON.parse calls in `executeDataTableWriteTool` (columns, rows, data, rowIds) lacked error handling. When LLM-generated tool arguments contained invalid JSON, the function would crash with uncaught SyntaxError instead of returning a proper error response. Now all four calls wrapped in try-catch blocks that return error messages via the `fail()` helper. Files: `agent/src/chat/data-table-tools.ts`.
- **"Prompt is too long" shows raw error in chat panel**: When a chat conversation grew too long for the model's context window, the error was displayed verbatim. Now detects context-length errors (`Prompt is too long`, `context_length_exceeded`, etc.) and re-throws a clear, actionable message: "This conversation is too long to process. Start a new thread to continue — use the + button above the chat." Files: `agent/src/chat/handler.ts`.

### Added
- **Social media engagement ethics preamble (`SOCIAL_MEDIA_ENGAGEMENT_PREAMBLE`)**: All browser-based jobs that interact with social media platforms now receive a mandatory 6-rule preamble enforcing authentic, non-promotional engagement. Rules cover: (1) genuine helpfulness, (2) no promotional/spammy language, (3) only mention the product when it directly solves the problem being discussed, (4) disclose affiliation when mentioning the product, (5) no duplicate/mass-posting, (6) skip the post entirely rather than shoehorn in a mention. Files: `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/src/executor/index.ts`.
- **Instance-id hallucination, Notion URL/tool quirks, silent navigate failure (Issues 19, 20, 21, 22, 2026-04-11)**: Four low/medium-severity prod-run failures from the 2026-04-10/11 audit resolved. **Issue 19 (~5 runs, incl. `361c2e6e`)**: after context compaction, the agent sometimes passed human-readable labels like `"hn-session"` or `"browser_1"` as `instance_id` and got back a bare `Instance not found: hn-session` — forcing a wasted `list_instances` round-trip. Fix: new `server._format_instance_not_found(instance_id)` helper builds the error message with the live UUIDs inline so the next retry can recover in one call, and `BROWSER_SYSTEM_PROMPT` now states up front that `instance_id` values are UUIDs assigned by `spawn_browser` (never labels). All 50 call sites in `server.py` rewritten via `replace_all` to raise through the helper. **Issue 20 (~4 runs, incl. `0f44c876`, `57ebae46`)**: `mcp__notion__notion-fetch` returns a 400 `URL type view not currently supported for fetch tool` when the URL carries a `?v=<viewId>` parameter; the agent then fell back to browsing Notion, which is slow and error-prone. Per the "Externalize Fixes" rule we cannot patch the external Notion MCP, but we CAN teach the agent — new `EXTERNAL_MCP_GUIDANCE` constant (appended to every run's system prompt via `--append-system-prompt`) tells Claude to strip `?v=` before calling `notion-fetch`. **Issue 21 (~3 runs, incl. `e335c529`)**: Claude occasionally called `mcp__notion__notion_fetch` (underscore) instead of the correct `mcp__notion__notion-fetch` (hyphen) — the existing code comment in `executor/index.ts` documented the quirk but didn't tell Claude itself. `EXTERNAL_MCP_GUIDANCE` now encodes the hyphen rule and explicitly calls out the broken underscore variant. **Issue 22 (~3 runs, incl. `e335c529`)**: `navigate()` returned `{"success": false}` with an empty title and NO error message when the CDP `Page.navigate` call timed out on unreachable hosts (ecom.gold, slow Google search URLs) — the agent then retried the same URL two more times before hitting the outer 120s tool timeout. Fix: `navigate()` now tracks a `navigate_error` variable and always populates `response["error"]` with a descriptive message ("Page.navigate CDP call timed out after 10s — the page did not start loading…") when `success=false`, so the agent gets an actionable signal on the first failed call instead of three silent ones. 5 new Python regression tests in `tests/test_instance_not_found_and_navigate_error.py` (helper existence + async signature, source-level call-site check, UUID listing, empty-list path, navigate error attachment). 3 new TypeScript tests in `agent/test/mcp-config-builder.test.ts` covering the `BROWSER_SYSTEM_PROMPT` UUID guidance and both `EXTERNAL_MCP_GUIDANCE` rules. Mirrored to `src-tauri/mcp-servers/browser/`. Files: `agent/mcp-servers/browser/src/server.py`, `agent/mcp-servers/browser/tests/test_instance_not_found_and_navigate_error.py`, `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/src/executor/index.ts`, `agent/test/mcp-config-builder.test.ts`, `src-tauri/mcp-servers/browser/src/server.py`, `src-tauri/mcp-servers/browser/tests/test_instance_not_found_and_navigate_error.py`.
- **Browser spawn / navigate / Quora fallback fixes (Issues 16, 17, 18, 2026-04-11)**: Three more prod-run failures from the 2026-04-10/11 audit resolved. **Issue 16 (transient `spawn_browser` -32000 "Browser window not found", ~4 runs incl. `e335c529`, `5b51a5ce`)**: `BrowserManager._do_spawn` now refreshes `browser.update_targets()` and probes the candidate tab with `evaluate("1")` after `uc.start()`, so a half-alive Chrome (returned before a page target is registered, or with a destroyed initial target) is detected immediately and torn down via `browser.stop()` before the retry loop runs — previously `main_tab` returned a stale target and the first CDP call failed with -32000. `MAX_SPAWN_RETRIES` bumped 3 → 4 with wider backoff (1.5s/3s/4.5s) so the profile-lock-recovery path has room to settle. **Issue 17 (`navigate()` 120s hard timeout, ~3 runs incl. `e335c529`)**: slow sites (LinkedIn profile pages, ecom.gold, slow Google) were blowing past the outer MCP `tool_timeout` wrapper's 120s limit, which forced a full browser teardown + respawn and then usually tripped the profile-lock-contention path (Issue 4). Fix: navigate's user-supplied `timeout` parameter is now clamped to an internal ceiling of 70s (`NAVIGATE_INTERNAL_CEILING_S`), leaving 50s of headroom under the outer 120s wrapper for `get_tab()` reconnect (~18s), best-effort URL/title reads (6s), and the CAPTCHA probe (5s). `get_tab()`'s per-attempt probe schedule also tightened from 5/8/11s to 4/6/8s so it fits comfortably inside that headroom. The agent now always gets a soft `{success: false}` response to retry against the same tab instead of a hard tool failure. **Issue 18 (Quora posting abandoned after spawning browser, runs `96b0dffc`/`5c601ac8`)**: prompt/memory fix — the agent was citing `workflow_launch_blockers_2026_04_11.md` as "memory notes about Quora's browser automation limitations" and bailing out to write `/tmp/QUORA_SEO_ANSWERS_READY_FOR_POSTING.md` instead of actually attempting to post. The memory file documented a **credential** blocker, not an automation limitation, so the agent had misread it. Per the "Externalize Fixes" rule no OpenHelm code was changed; the memory file was updated to (a) explicitly debunk the "browser automation limitations" framing, (b) state that Quora browser automation works fine when a session exists, and (c) forbid `/tmp/*.md` "manual posting" fallbacks (the job must fail explicitly with the real blocker, per the no-fallback rule). 5 new source-level regression tests in `tests/test_spawn_retry_and_navigate_ceiling.py` covering retry count, `update_targets`/probe, half-alive teardown, the internal ceiling constant, and the `get_tab` probe-budget invariant. Mirrored to `src-tauri/mcp-servers/browser/`. Files: `agent/mcp-servers/browser/src/browser_manager.py`, `agent/mcp-servers/browser/src/server.py`, `agent/mcp-servers/browser/tests/test_spawn_retry_and_navigate_ceiling.py`, `src-tauri/mcp-servers/browser/src/browser_manager.py`, `src-tauri/mcp-servers/browser/src/server.py`, `src-tauri/mcp-servers/browser/tests/test_spawn_retry_and_navigate_ceiling.py`, `~/.claude/projects/-Users-maxbeech-Documents-Beech-Development-OpenHelm/memory/workflow_launch_blockers_2026_04_11.md`.
- **Tech Debt Tracker / E2E Chat / OpenClaw DM Outreach job fixes (Issues 13, 14, 15, 2026-04-11)**: Three more prod-run failures from the 2026-04-10/11 audit resolved. **Issue 13 (Tech Debt Tracker, job `15f97087`, run `b1b5e5e8`)**: prompt-only fix — appended a clause stating that a clean audit with nothing to fix is a valid successful outcome, so the job no longer lingers as "partial failure" when it correctly concludes there's nothing actionable. **Issue 14 (E2E Wednesday Chat Job Creation Flow, job `c29e3cf8`, run `0b27c1a1`)**: prompt-only fix — pinned `headless=false` + `profile="athenic-test"` on spawn, require the entire test (message submission AND verification of the created job card) to happen on the same browser instance, fail fast with an explicit blocker name if the profile is locked or the instance is lost (no respawn, no ephemeral fallback, no re-login). **Issue 15 (OpenClaw DM Outreach, job `83d60bbc`, runs `ed16afd4`/`d991f2fe`/`af5062cf`)**: two-layer fix. Root cause: the Reddit browser credential `575995bd-5c1a-4b84-95c4-453a02513774` and its pre-authenticated browser profile `cred-575995bd-5c1a-4b84-95c4-453a02513774` WERE being delivered to the run via `writeBrowserCredentialsFile` + `buildBrowserCredentialsNotice` — the agent's first turn (`"check for Reddit API credentials"`) hallucinated a `~/.openhelm/reddit-config.json` Reddit Script App / PRAW workflow from its training-data prior and aborted with "BLOCKER: Reddit OAuth credentials missing" before actually using the loaded credential. (a) **Code:** `buildBrowserCredentialsNotice` in `agent/src/mcp-servers/mcp-config-builder.ts` now appends a "NO EXTERNAL API/OAUTH CONFIG FILES" clause whenever any browser credential is loaded, explicitly forbidding `~/.openhelm/*-config.json` / `*-cookies.json` lookups, PRAW, Reddit Script Apps, Tweepy, and the LinkedIn API, and instructing the agent to treat any API/OAuth workflow referenced in the job prompt as out-of-date in favour of the browser flow. 1 new regression test in `agent/test/mcp-config-builder.test.ts`. This fix applies to every browser job, not just Reddit. (b) **Prompt:** the OpenClaw DM Outreach job prompt got an "Authentication (read BEFORE any step)" section inserted before step 1 stating the Reddit credential is pre-loaded, naming the exact profile to pass to `spawn_browser`, and ruling out the API/config-file path in the job-specific context. Files: `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/test/mcp-config-builder.test.ts`, and prompt updates in `~/.openhelm/openhelm.db` (`jobs` table, rows `15f97087-19b2-4772-9194-0af0a5d1e588`, `c29e3cf8-5d36-4a70-82cd-73907742699c`, `83d60bbc-0665-4cb1-afa6-a0e1aad0e3ca`).
- **HN / PostHog job prompts rewritten to match external platform reality (Issues 8, 9, 2026-04-11)**: Two recurring prod failures traced to prompt-level bugs, not OpenHelm code bugs — fixed by rewriting the job prompts directly in the user's local SQLite DB (`~/.openhelm/openhelm.db`, `jobs` table) per the project's "Externalize Fixes" rule. Backups of the original prompts saved to `/tmp/openhelm-prompt-backup-20260411/jobs-backup.txt`. No OpenHelm source code was patched. **Issue 8 (Hacker News Engagement, job `078a8913`, ~5 failed runs incl. `7bd8506a`/`361c2e6e`/`6787d2bf`/`7727d22c`):** HN enforces an account-wide ~10–15 minute per-comment rate limit that persists across browser sessions (fresh spawn does NOT reset it). The old prompt asked for "2–3 substantive comments", so the first comment always posted, the second hit the `/x?fnid=...&fnop=comment-toofast` error page, and the whole run was marked failed even though real engagement had happened. New prompt caps the run at ONE comment, tells the agent to detect `comment-toofast` in the URL after submission as a first-comment failure (residual limit from a prior run — schedule spacing is an external fix), explicitly forbids a second attempt on another thread, and counts upvotes (which are not rate-limited) as legitimate run output. **Issue 9 (Sync PostHog Metrics, job `f0a31ef9`, run `db4a5654`):** PostHog's legacy insight endpoints (`/api/projects/{id}/insights/trend/` and `/api/projects/{id}/insights/retention/`) return HTTP 403 "Legacy insight endpoints are not available for this user" on our account tier; the agent was wasting a tool call + retry before self-discovering HogQL. New prompt forbids the legacy endpoints explicitly, sends all 5 metrics through `POST /api/projects/{id}/query/` with `HogQLQuery` payloads, provides exact SQL per metric using `person_id` + `toDate(timestamp)`, handles the retention cohort via two queries with `retention_7d_pct = null` on empty cohorts (not 0), and treats a non-403 HogQL error as a hard failure.
- **Profile lock contention across concurrent runs (Issue 4, 2026-04-11)**: Two concurrent OpenHelm runs that both fell back to `spawn_browser(profile="default")` would race on the filesystem lock file; the loser failed with `Profile 'default' is already in use by another task` and the agent then retried with no profile at all — losing cookies and tripping Cloudflare/Reddit bot detection within seconds. Separately, a sibling MCP subprocess that died hard (SIGKILL from the browser-cleanup sweep) could leave a lock file whose PID was subsequently reused by an unrelated process, making the existing `is_profile_locked` PID-alive check see a live PID and refuse to reap the stale lock forever. Fixes: (a) `profile_manager.acquire_lock` now also records `pid_start_time` via `psutil.Process.create_time()`; `is_profile_locked` verifies the live process's start time still matches the recorded value and clears the lock as stale on any mismatch — proper PID-reuse detection. (b) New `profile_manager.wait_for_unlock(name, timeout_seconds)` helper polls `is_profile_locked` for up to 15s (configurable via `OPENHELM_PROFILE_LOCK_WAIT_SECONDS`) before giving up, and `spawn_browser` calls it before `acquire_lock` so short overlaps between concurrent runs resolve into a transparent wait instead of an ephemeral-profile fallback. (c) New `profile_manager.release_all_held_by(pid)` sweeps every lock file whose owning PID matches, called from the server lifespan shutdown so SIGTERM-during-run no longer leaks locks. (d) `server._reconcile_profile_locks` now also disk-sweeps the profiles directory, letting `is_profile_locked` silently clear any lock whose PID is dead or PID-reused — catches locks left behind by sibling MCP subprocesses that were never tracked in `_instance_profiles`. 7 new unit tests (`TestLockPidReuseDetection`, `TestWaitForUnlock`, `TestReleaseAllHeldBy`, `TestReconcileDiskSweep`) in `tests/test_profile_lock_reconcile.py`. Mirrored to `src-tauri/mcp-servers/browser/src/`. Files: `agent/mcp-servers/browser/src/profile_manager.py`, `agent/mcp-servers/browser/src/server.py`, `src-tauri/mcp-servers/browser/src/profile_manager.py`, `src-tauri/mcp-servers/browser/src/server.py`.
- **Agent burns 20+ turns on Reddit signup modal / LinkedIn Lexical composer before giving up (Issues 5, 6a, 6b, 2026-04-11)**: Three distinct anti-automation blockers on external platforms (Reddit's signup-modal overlay + reCAPTCHA on comment submission; LinkedIn's Lexical message composer ignoring all programmatic text insertion; LinkedIn's connection modal suppressing synthetic clicks on "Send without a note") each caused the agent to thrash for dozens of turns — retrying `paste_text`, executing broken `execute_script` snippets, clicking the same disabled button — before the run eventually failed. Per the project's "Externalize Fixes" rule these are not OpenHelm bugs: the platforms are actively blocking automation and the right behaviour is a clean, fast refusal with an explicit blocker name in the run log. Fixes: (a) `dom_handler._build_input_verification` now emits a `blocker` field on the verification dict returned by `paste_text` / `type_text` when insertion silently fails. Two generic classifiers — `contenteditable_editor_rejected_insert` (real visible contenteditable, 0 chars inserted — Lexical/ProseMirror class) and `editor_hidden_or_overlay` (resolved target is hidden, no activator fired — Reddit signup-modal class) — name the blocker without any site-specific logic. (b) `BROWSER_MCP_PREAMBLE` in `agent/src/mcp-servers/mcp-config-builder.ts` gains four mandatory stop rules (F–I): Reddit signup-modal detection → `check_session` → `request_user_help` or stop with `blocker: "reddit_session_expired"`; LinkedIn Lexical editor → maximum 2 retries then stop with `blocker: "linkedin_message_composer"`; LinkedIn connection modal → maximum 1 retry then stop with `blocker: "linkedin_connection_modal"`; general rule capping any anti-automation situation at 2 structured retries before STOP-and-report. The agent is now explicitly told NOT to fall back to `execute_script` / clipboard hacks / DOM manipulation when these blockers appear, because those techniques provably do not work and only waste tokens. 4 new unit tests in `tests/test_input_verification.py` (`test_verification_flags_contenteditable_blocker_on_silent_reject`, `test_verification_flags_hidden_editor_blocker`, `test_verification_does_not_flag_blocker_on_success`, plus whitespace regression). Mirrored to `src-tauri/mcp-servers/browser/`. No Reddit- or LinkedIn-specific code was added to the browser MCP — both classifiers are generic editor-state heuristics. Files: `agent/mcp-servers/browser/src/dom_handler.py`, `agent/src/mcp-servers/mcp-config-builder.ts`, `src-tauri/mcp-servers/browser/src/dom_handler.py`.
- **MCP tool-missing false failures when Claude recovered (Issue 1, 2026-04-11)**: Runs were being force-failed whenever `"No such tool available: mcp__..."` appeared anywhere in the logs — even when Claude immediately recovered by retrying with the correct tool name (e.g. `notion_fetch` underscore → `notion-fetch` hyphen) or the MCP server warmed up after the first missed call. The executor bypassed outcome assessment entirely and scheduled an auto-retry, so 15+ LinkedIn/Reddit/Notion runs that had already completed their mission were needlessly retried, wasting tokens and occasionally double-posting. Fix: replaced the blunt `hasMcpToolMissingError()` check with `countMcpToolMissingErrorsByServer()` + `findUnrecoveredMcpServers()` which compares the per-server error count to the per-server tool-use invocations from the runner's `toolStats`. Only servers where `invocations <= errors` (i.e. every attempt erred) are treated as genuinely unrecovered. Recovered runs now flow through normal outcome assessment and are marked succeeded. Files: `agent/src/db/queries/run-logs.ts`, `agent/src/executor/index.ts`, `agent/test/executor.test.ts` (+1 new test).
- **X.com CAPTCHA timeout → agent pivots to wrong platform (Issue 2, 2026-04-11)**: When X.com blocked with a Cloudflare Turnstile challenge, the agent called `request_user_help`, polled briefly, then fell back to posting on Hacker News entirely — a different platform from the one the job specified. The run was marked succeeded because HN posts went through, but the actual job ("X.com engagement") was never done. Root cause was (a) contradictory guidance — `request_user_help` docstring said "give up after 5 minutes" while the browser preamble said "poll for 15 minutes", and (b) no rule anywhere forbade switching target platforms. Fix: aligned both to a 15-minute minimum wait, added explicit "NEVER pivot to a different target platform after CAPTCHA timeout" rule to `BROWSER_CAPTCHA_PREAMBLE`, and taught the outcome assessor to mark platform-pivot runs as HIGH-confidence failures regardless of how much work was done on the substitute platform. Files: `agent/src/mcp-servers/mcp-config-builder.ts`, `agent/src/planner/outcome-assessor.ts`, `agent/mcp-servers/browser/src/server.py`, `src-tauri/mcp-servers/browser/src/server.py`.
- **Browser session lost on Claude Code context compaction (Issue 3, 2026-04-11)**: When the context window filled up, Claude Code compacted the conversation and started a "new" session. The Python browser MCP subprocess was NOT killed — it still held the live Chrome instance with all its cookies/auth — but the new session didn't know the old `instance_id`. It called the old ID, got "Instance not found", then called `spawn_browser(profile="default")`, hit "Profile 'default' is already in use" from the live instance, and derailed into fresh logins and re-CAPTCHAs. Fix: `spawn_browser(profile=...)` now scans `_instance_profiles` for a live instance bound to the same profile and transparently returns it (`reused: true`) instead of trying to spawn a fresh Chrome. Added cross-compaction recovery guidance to `BROWSER_PROFILE_PREAMBLE` telling Claude to call `list_instances` first after compaction. Mirrored to src-tauri bundled copy. Files: `agent/mcp-servers/browser/src/server.py`, `src-tauri/mcp-servers/browser/src/server.py`, `agent/src/mcp-servers/mcp-config-builder.ts`.
- **14 Chrome browsers accumulating with "Something went wrong when opening your profile" dialog**: Fixed root cause where the orphan process scan in `browser-cleanup.ts` only matched Chrome instances launched with nodriver temp dirs (`uc_*` prefix), completely ignoring named-profile Chromes (`~/.openhelm/profiles/<name>/`). When macOS `find_pid_on_port` lost the race against a slow profile load and returned `None`, the Chrome PID wasn't tracked in the PID file AND the process scan skipped it — so those Chromes were never killed. Over 15+ hours of running they accumulated, each new run spawning a fresh Chrome on the same profile, which triggered Chrome's "profile already in use" conflict dialog. Fix: (1) Updated `findOrphanedNodriverPids` to also match `user-data-dir=~/.openhelm/profiles/` paths — both cleanup paths (per-run and startup sweep) now catch named-profile Chromes. (2) Increased `find_pid_on_port` retries from 15×0.3s to 30×0.5s (15s total) to handle large profiles that take >4.5s to start on macOS. (3) Removed dead CAPTCHA-exception code in the executor that was always false (since `interventionWatcher.stop()` clears `createdItemIds` before the check). The 14 accumulated Chrome processes were killed as part of this fix. Files: `agent/src/mcp-servers/browser-cleanup.ts`, `agent/src/executor/index.ts`, `agent/mcp-servers/browser/src/browser_manager.py`.
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
### Added (Plan 13 — Public demos at /demo/:slug)
- **Public, read-only demos reachable at `app.openhelm.ai/demo/:slug`.** Anonymous visitors land in a fully seeded OpenHelm workspace for a given company (e.g. `/demo/nike`), browse the full UI, and send rate-limited real-model chat messages — with every write action intercepted into a sign-up modal. Defence in depth: RLS at the DB, transport guard on the wire, unhandled-rejection handler on the UI.
  - **Minimal router wrap** (`src/router.tsx`) — react-router v6 `BrowserRouter` routes `/demo/:slug/*` to `<DemoRoute>` (lazy-loaded) and delegates every other path to the existing Zustand-driven `<App>`. No existing view had to be migrated to routes; further per-view migration is a follow-up.
  - **`<DemoRoute>`** (`src/routes/demo-route.tsx`) — calls `supabase.auth.signInAnonymously()` if no session exists, looks up the project by slug via the new `projects.getBySlug` CRUD method, flips `useDemoStore.enter()`, seeds `useAppStore` (`activeProjectId`, `onboardingComplete=true`, `agentReady=true`, `contentView='dashboard'`), and renders `<App>` inside a `<DemoFrame>`. Cleanup on unmount calls `leave()` so navigating away cleanly exits demo mode. Handles `loading / ready / not_found / error` states explicitly.
  - **`<DemoFrame>` + `<DemoBanner>` + `<DemoSignupModal>`** (`src/components/demo/`) — sticky 40px banner with "You're viewing the {project} demo", a READ-ONLY badge, and a context-aware CTA (sign-up for anon visitors, "Back to your workspace" for logged-in users detected via `user.is_anonymous`). Signup modal copy branches on trigger: `cta_click` / `write_blocked` / `rate_limit`, each with tailored messaging. Modal routes to `/login?from=demo&slug=…`.
  - **`DemoReadOnlyError` + transport write guard** (`src/lib/demo-errors.ts`, `src/lib/transport-supabase.ts`) — `SupabaseTransport.request()` now enforces an explicit **allowlist** of read-only methods when `useDemoStore.isDemo` is true. Fail-closed: any method not in the allowlist throws a `DemoReadOnlyError` before the network roundtrip. A global `unhandledrejection` handler installed in `main.tsx` catches the error, fires the `demo_write_blocked` PostHog event with the attempted method, and opens the signup modal — zero per-callsite changes required.
  - **`DemoRateLimitError` (code 4290)** — the worker returns JSON-RPC error code 4290 when a demo visitor exceeds a rate limit; the frontend `workerRpc` helper maps that into a `DemoRateLimitError`, which the same global handler converts into the signup modal with rate-limit copy.
  - **`AuthGuard` exemption** (`src/components/auth/auth-guard.tsx`) — `/demo/*` paths bypass the cloud login redirect, letting the `DemoRoute` handle its own anonymous sign-in.

- **Database migrations** (`supabase/migrations/`):
  - `20260414000001_demo_projects.sql` — adds `projects.is_demo` + `projects.demo_slug`, a partial unique index (`WHERE is_demo = true`), and a SECURITY DEFINER `is_demo_project(text)` helper that child-table RLS policies use. `SECURITY DEFINER` is essential — without it, an anonymous user's RLS-scoped SELECT on `projects` inside the helper would return zero rows and break the child-table demo checks.
  - `20260414000002_demo_rls_policies.sql` — additive SELECT policies on `projects, goals, jobs, runs, run_logs, data_tables, data_table_rows, visualizations, memories, conversations, messages` that OR with existing per-user policies. Writes stay blocked (demo rows aren't owned by the anon `auth.uid()`). Private tables (`credentials, subscriptions, usage_records, settings, inbox_events, autopilot_proposals, claude_usage_snapshots, run_memories, inbox_items, targets, data_table_changes, credential_scope_bindings, run_credentials`) intentionally have NO demo policy.
  - `20260414000003_demo_rate_limits.sql` — new `demo_rate_limits` + `demo_daily_budget` tables, plus `increment_demo_session()` and `increment_demo_budget()` SECURITY DEFINER atomic upsert functions granted only to `service_role`. RLS intentionally left disabled — no user JWT should ever touch these tables.
  - `demos/20260414000100_demo_nike.sql` — idempotent Nike seed (project, 3 goals, 6 jobs, 13 runs with realistic summaries/token counts/correction flows, 8 run_logs for one fleshed-out run, 3 data tables, 5+14 rows, 2 visualizations, 3 memories, 1 conversation with 4 chat messages). Uses relative timestamps (`now() - interval '…'`) so the dashboard "last 30 days" window stays fresh without CI re-seeds. `ON CONFLICT … DO UPDATE` makes re-running safe. `scripts/reset-demo.sh <slug>` runs the seed against the linked Supabase project.
  - `supabase/config.toml` — `enable_anonymous_sign_ins = true`.

- **Worker: rate-limited demo chat** (`worker/src/demo-rate-limit.ts`, `worker/src/index.ts`, `worker/src/chat-handler.ts`):
  - Three layered caps, cheapest check first: **global daily $20 budget** (across all demo visitors), **per-session 10 messages** (per Supabase anon session + slug), **per-IP 50 messages / 24h** (rolling window, sha256-hashed `X-Forwarded-For`). Worst-case monthly cost is bounded at ~$600 even under hostile traffic.
  - The RPC handler now decodes `is_anonymous` + `sub` from the bearer JWT payload, extracts the first IP from `X-Forwarded-For`, and passes `{ authUserId, isAnonymous, clientIp }` as a context object to every RPC dispatch.
  - `chat.send` enforces the rate limit only when `isAnonymous` is true; authenticated users on `/demo/:slug` bypass the cap entirely. Anonymous chat forces `permissionMode: "plan"` so the tool loop is read-only — a real logged-in user's requested mode is honoured unchanged. Per product direction the demo uses the **full** model tier (Haiku/Sonnet) — no dumb-down. `handleChatSend` accepts an optional `demoContext: { slug, ipHash }` and calls `recordDemoMessage(costUsd)` only after a successful LLM call, so failed runs don't burn a credit.
  - `DemoRateLimitError` is surfaced as JSON-RPC `{ error: { code: 4290, message: reason } }` — HTTP 200 per JSON-RPC convention, not 500.

- **Tests**:
  - `src/stores/demo-store.test.ts` (4 tests) — enter/leave/showSignupModal/hideSignupModal state transitions.
  - `src/lib/demo-errors.test.ts` (8 tests) — error class construction, type guards (including duck-typing across realms), error code constant.
  - `src/lib/mode.test.ts` (7 tests) — `isDemoPath` / `getDemoSlug` including URL-decoding and non-match cases.
  - `worker/src/__tests__/demo-rate-limit.test.ts` (13 tests) — `hashIp` stability/sensitivity, `extractClientIp` parsing, all three rate-limit layers, and `recordDemoMessage` RPC calls. Mocks `getSupabase()` via `jest.unstable_mockModule`.
  - Full suite green: agent 76 files / 1011 passed, frontend vitest 42 files / 368 passed, worker jest 8 suites / 85 passed.

### Fixed (Plan 13 — discovered during Taylor Wessing + Nike E2E testing)
- **Schedule config field names**. The seed migrations initially used `{cron: "…"}` and `{intervalMinutes: N}` but the canonical `ScheduleConfig` types are `{expression: "…"}` and `{minutes: N}`. Rendering a job in the sidebar crashed the whole view with `TypeError: Cannot read properties of undefined (reading 'split')` because `describeCron(cfg.expression)` blew up on undefined. Fixed three ways: (1) hardened `describeCron()` in `src/lib/format.ts` to return `"Cron: (invalid)"` instead of throwing, (2) added a `cfg?.time` guard in the calendar branch of `src/components/layout/sidebar-job-node.tsx`, (3) rewrote the Nike + Taylor Wessing seed SQL files to use the correct field names and migrated live rows with a one-shot UPDATE.
- **Visualization config schema migration**. The seeds used the legacy `{xColumn, yColumn, yLabel}` shape; the current `VisualizationConfig` is `{xColumnId, series: [{columnId, label}]}`. Opening a job detail view crashed with `Cannot read properties of undefined (reading 'map')` at `visualization.config.series.map(…)`. Fixed: migrated live visualization rows via `UPDATE visualizations SET config = jsonb_build_object(…)` and rewrote the seed files with the current schema.
- **Cloud-mode data-tables + visualizations + targets CRUD handlers were missing.** `dataTables.list`, `dataTables.listAll`, `dataTables.get`, `dataTables.listRows`, `visualizations.list`, `visualizations.get`, `targets.list`, `targets.evaluateAll` all fell through to the default "Method not implemented in cloud mode" error — the entire Data / Visualization surface was dead in cloud mode, not just demos. Added implementations in `src/lib/transport-supabase-crud.ts` that use PostgREST with RLS so real cloud users also benefit. `targets.evaluateAll` returns an empty array for now (no targets seeded in demos; real cloud users can still build targets but evaluation is a follow-up).
- **JSONB camelization corrupted user-defined keys in data tables.** `camelizeKeys()` recursively camelized every object it touched, including JSONB business data. A row inserted with `{spend_gbp: 6420}` arrived on the frontend as `{spendGbp: 6420}`, but the column definition's `id: "spend_gbp"` was inside `columns` JSONB and stayed as a string value (not an object key) so it wasn't transformed — the `row.data[col.id]` lookup mismatched on every underscore-containing column, rendering cells blank. Fixed with a `JSONB_FIELDS_TO_PRESERVE` allowlist in the camelizer: `data`, `columns`, `config`, `schedule_config` / `scheduleConfig`, `tool_calls`, `tool_results`, `pending_actions`, `metadata`, `tags`, `raw_user_meta_data` now pass through unchanged. Affects real cloud users too — the bug silently corrupted any data-table column id or JSONB field with underscores.
- **Demo transport guard rewrite — allowlist → denylist + quiet no-op**. The original fail-closed allowlist was unmaintainable: every view on mount fires read methods that had to be individually whitelisted (`memories.listTags`, `claudeCode.checkHealth`, `targets.evaluateAll`, `dataTables.listAll`, and a dozen others), each one opening the modal spuriously during navigation. Rewrote `transport-supabase.ts` to classify methods into three buckets:
  1. **Loud writes** — match a suffix like `.create / .update / .delete / .insertRows / .addColumn / .archive / .trigger / .approve / .dismiss / …` or one of a small set of exact names (`scheduler.pause`, `executor.stopAll`). These open the signup modal + throw `DemoReadOnlyError`.
  2. **Quiet writes** — `settings.set`, `settings.delete`, `browserMcp.focusBrowser`, `power.checkAuth`, `permissions.*`. Silently return a synthetic `{ok: true, demoNoop: true}` so the caller's `.catch()` never fires and navigation proceeds.
  3. **Reads** — everything else, including newly-added methods. No changes needed to add a new read.

  `chat.send` is explicitly NOT classified as loud so the worker's demo rate limiter handles it (per-session 10, per-IP daily 50, global $20/day). This removes a large class of whack-a-mole bugs and makes the demo mode sustainable as new features ship.
- **Modal-opens-from-transport fix.** Several Zustand stores wrap mutation API calls in `try { … } catch { set({error}) }`, which silently swallows `DemoReadOnlyError`. The global `unhandledrejection` handler in `src/lib/demo-errors.ts` never saw it. Fixed by opening the signup modal synchronously from inside the transport's write guard (before the throw), guaranteeing every blocked write surfaces a conversion moment regardless of how the caller handles the error.

### Added (Plan 13 — Taylor Wessing demo seed)
- **New `/demo/taylor-wessing` seed** (`supabase/migrations/demos/20260414000101_demo_taylor_wessing.sql`) covering all 5 use cases from the sales brief: 1 project, 5 goals, 14 jobs, 25 runs (with a self-corrective failure→retry sequence), 10 run_logs, 5 data tables (`tool_health_status`, `regulatory_updates`, `litiumtw_eval_scores`, `insights_seo_scores`, `bd_prospect_pipeline`) with 51 rows total, 2 visualizations, 5 memories, 1 chat conversation with 4 seeded messages. Content is Taylor-Wessing-specific — names real tools (LitiumTW, Legora, LitiGate, TechSet, TW:navigate, Global Data Hub, GDPR hub, Patent Map, SM&CR portal), references real practices (IP, TMC, Life Sciences, Private Wealth), and mentions the Sona Labs client relationship from the brief. All timestamps are relative so the dashboard "last 30 days" window stays current.

### Verified (E2E via Browser MCP)
Manually navigated both demos end-to-end at `http://localhost:1420/demo/nike` and `http://localhost:1420/demo/taylor-wessing`:
- Banner, read-only badge, sign-up CTA all render.
- Sidebar shows correct goals + jobs with human-readable schedules ("Daily at 2:00", "Every 1 hr", "Every Mon at 9:00", "Daily at 11:00").
- Dashboard shows correct active-goal / enabled-job / recent-success counts and the 14-day run outcomes bar chart with real data.
- Data Tables list renders all tables with column badges and row counts.
- Clicking into `campaign_performance` (Nike) and `tool_health_status` (Taylor Wessing) shows all rows with every column populated — including the previously-broken `spend_gbp` / `uptime_pct_30d` numeric columns.
- Job detail view loads with prompt, schedule, run history (including the failed → corrective sequence), live-rendered line + bar charts from the visualization config, and Targets / Charts sections.
- Memory view shows all 5 seeded memories with tags and importance.
- Inbox, Credentials, and Memory views all load without triggering spurious modals.
- Clicking `New Credential → Create` correctly opens the signup modal with `trigger: "write_blocked", method: "credentials.create"`.
- Chat panel shows pre-seeded conversation history; typing a message + clicking send routes to `chat.send` (not blocked, will be worker-rate-limited when the worker is running).
- Full navigation sweep (Dashboard → Memory → Inbox → Data → Credentials → Dashboard) produced **zero spurious modal openings**.

## [Unreleased] - 2026-04-11 (before plan 13)

### Added (Cloud-mode interactive credential setup)
- **"Set Up Browser Session" works in cloud mode.** Previously, clicking "Open Browser" in the credential setup dialog failed with `[transport-supabase] Method not implemented in cloud mode: credential.setupBrowserProfile` because there was no way to stream a live browser from an E2B sandbox back to the frontend. Fixed end-to-end:
  - **E2B template swapped to `e2bdev/desktop`** (`e2b/Dockerfile`) — unified XFCE + Chromium + noVNC image used for BOTH credential setup sessions and normal job runs. Run-time Chromium drops `--headless=new` since it now has a real display; this also unlocks future "watch the agent work" features on the same substrate.
  - **Three new Worker RPCs** in `worker/src/credential-setup.ts` + `credential-setup-session.ts`: `credential.setupBrowserProfile` spawns a desktop sandbox via `@e2b/desktop`, launches Chromium with `--user-data-dir=/home/user/profiles/cred-${id}`, calls `sandbox.stream.start()`, and returns `sandbox.stream.getUrl()` — a browser-embeddable signed noVNC URL. `credential.finalizeBrowserProfile` tars the profile, uploads it to a new private `browser-profiles` Supabase Storage bucket keyed `{user_id}/{credential_id}.tar.gz`, stamps `credentials.browser_profile_storage_key` / `browser_profile_verified_at`, and kills the sandbox. `credential.cancelBrowserSetup` tears down a setup sandbox without saving. 30-minute hard timeout per session; ownership checks on every RPC.
  - **Frontend iframe flow** in `src/components/credentials/browser-setup-step.tsx` branches on `isCloudMode`: when cloud, renders the signed stream URL in a sandboxed iframe and replaces the `⌘Q` detection flow with a **Done — Save Login** button that calls finalize directly. Local Tauri flow unchanged.
  - **Run-time profile hydration** in `worker/src/profile-hydration.ts` — before every run, downloads any in-scope credential profile tarballs from Supabase Storage and extracts them under `/home/user/profiles/`. The first hydrated profile path is passed via `OPENHELM_BROWSER_PROFILE_DIR` to the `openhelm-browser` MCP (`worker/src/executor.ts` `buildMcpConfig()`).
  - **Schema**: `supabase/migrations/20260411000001_browser_profile_storage.sql` adds `credentials.browser_profile_storage_key`, `credentials.browser_profile_verified_at`, and the `browser-profiles` storage bucket with per-user RLS (`auth.uid()::text = (storage.foldername(name))[1]`). Matching Drizzle columns in `agent/src/db/schema-postgres.ts`.
  - **Transport routing**: `credential.setupBrowserProfile`, `.finalizeBrowserProfile`, `.cancelBrowserSetup` added to `WORKER_METHODS` in `src/lib/transport-supabase.ts` so they dispatch to the Worker RPC instead of falling through to the "not implemented" error.
  - **Shared types**: `SetupBrowserProfileResult` now carries optional `streamUrl`, `sandboxId`, `expiresAt`; new `FinalizeBrowserProfileParams` / `Result` types in `shared/src/index.ts`. `cancelBrowserSetup()` API wrapper accepts either a string credentialId (local) or `{ sandboxId }` (cloud).
  - **Unified E2B template built.** The first build attempt was blocked by `404: template 'openhelm-goose' not found` because no such template existed in the user's E2B account — the original Dockerfile used `FROM e2bdev/desktop` which is NOT a real Docker Hub image (E2B desktop is built programmatically via a Python SDK template in their repo). The Dockerfile was rewritten to `FROM ubuntu:22.04` with the entire desktop stack inlined: xserver-xorg, xvfb, xfce4 + xfce4-goodies, x11vnc, xdotool, scrot, net-tools, libgtk-3-bin, plus a git clone of e2b-dev/noVNC (`e2b-desktop` branch) into `/opt/noVNC` and websockify v0.12.0 into `/opt/noVNC/utils/websockify` — exactly matching the paths the `@e2b/desktop` SDK's `VNCServer.novncCommand` hard-codes. Chromium-browser's Ubuntu 22.04 apt package turned out to be a snap-transition stub that fails in containerised E2B sandboxes, so the template installs `google-chrome-stable` from the official Google deb repo instead (and `credential-setup.ts` launches `google-chrome-stable` rather than `chromium`). Goose's release URL was fixed from `goose-linux-amd64` (404) to `goose-x86_64-unknown-linux-gnu.tar.bz2` with a bzip2 extract step. `e2b/e2b.toml` was flattened to the CLI 1.4.1 schema (top-level `dockerfile` / `template_id` / `team_id` keys rather than `[template]` section), and `.env.local` / `.env.example` now reference the resulting template ID `zbo3wmwqm9fq4ta26zyh` directly.
  - **End-to-end verified.** Direct Worker RPC calls (via forged JWT — the worker decodes without signature verification per comment at `worker/src/index.ts:265`) confirmed: `credential.setupBrowserProfile` spawns a real E2B Desktop sandbox, launches Google Chrome against the XFCE display, calls `sandbox.stream.start()`, and returns a signed noVNC URL that resolves to a live `WebSockify Python/3.10.12` HTTP 200 — `credential.cancelBrowserSetup` tears the sandbox down cleanly.
  - **Tests**: 12 new worker tests in `credential-setup.test.ts` + `profile-hydration.test.ts` covering setup → finalize → cancel happy path, ownership rejection, cookies-size heuristic (likely_logged_in vs no_cookies_detected), scope resolution (global / project-match / out-of-project exclusion), and download-failure skip. 3 new frontend tests in `browser-setup-step.test.tsx` covering iframe render, finalize on Done, cancel on unmount, and error surfacing. Worker suite: 72/72.  Follow-up work on a per-job headless/desktop toggle and a lightweight LLM classifier is documented as a "Future Phase" section in `docs/plan_12_hosted_cloud_deployment.md`.

### Fixed (Cloud-mode chat: web tools, auto-rename, model labels)
- **Cloud-mode chat now has a real tool loop.** The worker's `chat.send` handler previously did a single bare LLM call with no tools — so asking for factual information produced "I can't browse the internet" refusals in both read-only and full-access modes. It now runs a multi-turn tool loop using OpenAI native function calling against OpenRouter. New files under `worker/src/chat/`:
  - `tool-schemas.ts` — two curated tool sets (READ_ONLY_TOOLS and FULL_ACCESS_TOOLS) in OpenAI function-calling JSON Schema format
  - `tool-executor.ts` — dispatcher that runs web tools via `fetch` and data tools against Supabase with explicit `user_id` filtering
  - `web-tools.ts` — `searchWeb()` (DuckDuckGo HTML) and `fetchUrlAsText()` with regex-based HTML stripping (no jsdom dep — keeps the worker bundle small)
  - `tool-loop.ts` — core loop with 5-iteration cap, forced tool-free summary on cap, usage metering, token accumulation across turns
  - `system-prompt.ts` — advertises tools and injects the user's project list so the LLM knows what to call
- **Read-only mode** exposes web_search, web_fetch, list_projects, list_goals, list_jobs, list_runs, get_run_logs.
- **Full-access mode** adds create_goal, archive_goal, create_job, archive_job (auto-executed in cloud — pending-action confirmation cards for cloud are a follow-up).
- **Cloud-mode chat threads now auto-rename from "New Chat"** on the first user message. New `worker/src/chat/auto-rename.ts` runs a fire-and-forget classification `llmCall`, updates the conversation title via Supabase, and broadcasts `chat.threadRenamed` on the user's event channel. Rename failures never block a chat response.
- **`worker/src/index.ts`** now passes `permissionMode` through from the `chat.send` RPC payload to the handler — previously it was destructured-and-dropped.
- **`worker/src/llm-router.ts`** — exported `getOpenRouterClient()` and `resolveModel()` so the tool loop can make raw tools-aware completions without duplicating auth setup.
- **Model selector labels**: `CHAT_MODELS` in `src/stores/chat-store.ts` renamed from Haiku/Sonnet/Opus (Claude-specific, misleading in cloud mode where we use GPT-4o) to mode-agnostic tier names Fast/Balanced/Advanced. The `value` strings stay stable so persisted state and backend model mappings continue to work in both modes.
- **Tests**: `worker/src/__tests__/chat-handler.test.ts` rewritten to mock the new chat/* module layer; 14 test cases covering tool-set selection per mode, tool-call persistence, auto-rename triggering on first message only, history loading, and error paths. Worker test suite passes 61/61.

## [Unreleased] - 2026-04-10

### Changed (Chat tool access redesign)
- **Chat tool access modes simplified to just two**: Read-only (`plan`) and Full access (`bypassPermissions`). The `Auto` option was removed from both local and cloud builds — `src/stores/chat-store.ts` no longer lists it.
- **Full-access chat now routes through `backend.run()`** — the same agentic code path used by scheduled jobs — via a new `agent/src/chat/agentic-runner.ts`. This gives chat full parity with scheduled jobs: browser MCP, data tables MCP, and (in cloud mode) E2B sandboxed execution. Prior chat history is prepended into the prompt; v1 is single-turn per message.
- **MCP context setup extracted** from `agent/src/executor/index.ts` into `agent/src/mcp-servers/build-run-mcp-context.ts` so the executor and the full-access chat runner share one implementation.

### Added (Chat web tools)
- **`agent/src/chat/web-fetch.ts`** — `fetchUrlAsText()` and `searchWeb()` helpers backed by the root package's already-installed `jsdom`. No new dependencies.
- **`web_search` + `web_fetch` chat tools** (`agent/src/chat/tools.ts`, `agent/src/chat/tool-executor.ts`) — read-only chat can now search the web (DuckDuckGo HTML endpoint) and fetch readable page text. `executeReadTool` is now async to accommodate network I/O.
- **`agent/test/chat-web-fetch.test.ts`** — 11 unit tests covering HTML extraction, JSON passthrough, truncation, scheme rejection, DuckDuckGo parsing, and error paths.

### Fixed (Goose backend MCP forwarding)
- **`GooseBackend.buildRunArgs()` now forwards `--mcp-config`** when `config.mcpConfigPath` is set (`agent/src/agent-backend/goose/index.ts`). Previously the flag was silently dropped, so scheduled-job runs in cloud mode spawned Goose with **zero MCP servers** — browser and data-tables tools were effectively disabled. The claude-code backend and the E2B worker were already correct; only the local Goose backend was mis-wired. Two outdated comments in the same file (line 8 and the `GOOSE_MCP_EXTENSION_FLAGS` dead-code comment) were removed. Regression-tested in `agent/test/goose-backend.test.ts` with a spawn-args capture mock.

## [Unreleased] - 2026-04-06

### Added (Plan 12, Phases 8–10: Stripe Billing, Integration Tests, Production Deployment)

#### Phase 8: Stripe Integration
- **`worker/src/stripe-billing.ts`** — Stripe REST API wrapper (no SDK dependency): `createCheckoutSession` (new Cloud subscriptions with 7-day trial), `createPortalSession` (Stripe Customer Portal for billing management), `reportUsageOverage` (end-of-period metered overage reporting via Stripe Usage Records API)
- **`worker/src/index.ts`** — three new RPC handlers:
  - `billing.createCheckout` — creates Stripe Checkout session with user_id metadata; resolves user email from Supabase Auth
  - `billing.createPortalSession` — creates Customer Portal session using stored `stripe_customer_id`
  - `jobs.create` — creates a job record in Supabase (used by onboarding wizard and cloud frontend)
- **`worker/src/config.ts`** — added `stripeSecretKey`, `stripePriceStarter/Growth/Scale`, `appUrl` optional config fields
- **`supabase/functions/stripe-webhook/index.ts`** — added `checkout.session.completed` handler: upserts subscription record with `user_id` from session metadata, linking Stripe customer to Supabase user on first purchase
- **`supabase/functions/validate-license/index.ts`** — new Edge Function: validates Business tier license keys; callable without Supabase Auth session (desktop app uses this); returns `{ valid, plan, maxSeats, email, expiresAt }`
- **`supabase/migrations/20260406000005_license_keys.sql`** — `license_keys` table with RLS (service_role only) + `validate_license_key(key)` Postgres function (granted to anon role so desktop apps can call without auth)

#### Phase 9: End-to-End Integration Tests
- **`worker/src/__tests__/integration.test.ts`** — integration test suite covering all major cloud scenarios:
  - Run creation: scheduler tick creates run record + fires onRunReady callback
  - Empty tick: no runs created when no jobs are due
  - Disabled job filtering
  - Concurrency limit enforcement (user at max concurrent runs is skipped)
  - Crash recovery: `recoverOrphanedRuns()` handles stale "running" runs on restart
  - Multi-tenant isolation: each user's jobs enqueue independently
  - Run ID uniqueness across all users
  - Usage metering: haiku < sonnet < opus cost ordering, 20% markup invariant, Haiku-equivalent multipliers (12x Sonnet, 20x Opus)
  - Schedule computation: once/interval/cron helpers
- **`worker/src/__tests__/stripe-billing.test.ts`** — 15 unit tests for Stripe billing functions using ESM-compatible mocking (`jest.unstable_mockModule`)
- **`worker/src/__tests__/setup.ts`** — Jest setup file: sets required env vars before any module loads (prevents config validation from throwing in test environment)
- **`worker/jest.config.js`** — added `setupFiles` pointing to setup.ts; enables env-var-dependent modules in tests

#### Phase 10: Production Deployment & Launch
- **`.env.example`** — root-level env var reference covering all services (Supabase anon/service keys, Worker secrets, Stripe price IDs, E2B, frontend VITE_ vars, local agent website URL)
- **`worker/fly.toml`** — added rolling deploy strategy (avoids dropping in-flight runs), Prometheus metrics endpoint at `:9091/metrics` for Fly.io dashboard monitoring
- **Security audit** (all items verified):
  - RLS enabled on all tables including new `license_keys` table
  - `SUPABASE_SERVICE_KEY` never referenced in frontend code (only in Worker)
  - Stripe webhook signature verified via HMAC-SHA256 (constant-time comparison)
  - License key validation uses `SECURITY DEFINER` function to prevent direct table access
  - CORS headers set on Worker HTTP server (`Access-Control-Allow-Origin: *` appropriate for known JWT-authenticated endpoints)
  - No API keys in committed code; all via environment variables

### Added (Plan 12, Phases 6–7: Hosted Cloud Deployment)

#### Phase 6: Cloud Frontend Features
- **`src/components/cloud/usage-dashboard.tsx`** — billing/usage overview for cloud mode: token credit progress bar, daily usage bar chart (recharts), breakdown by call type (execution/chat/planning/assessment), cost projection for current billing period; fetches from `usage-report` Edge Function + `usage_records` table
- **`src/components/cloud/usage-chart.tsx`** — recharts `BarChart` component for daily token usage; renders Haiku-equivalent token buckets per calendar day in the billing period
- **`src/components/cloud/plan-manager.tsx`** — current plan display (name, status, renewal date) with Stripe Customer Portal redirect (via Worker `/rpc`); inline plan selector for upgrades; past_due warning banner
- **`src/components/cloud/plan-selector.tsx`** — Starter/Growth/Scale plan cards with pricing, token allowances, and feature lists; "Most popular" badge on Growth; calls back with selected plan for checkout
- **`src/components/cloud/onboarding-wizard.tsx`** — 5-step cloud onboarding (Welcome → Plan → Project → Job → Complete); creates project with git URL, creates first job via Worker RPC, handles Stripe checkout redirect flow
- **`src/components/shared/new-project-dialog.tsx`** — now mode-aware: cloud mode shows git repository URL field (no folder picker); local mode unchanged
- **`src/components/settings/settings-screen.tsx`** — cloud mode renders Plan Manager + Usage Dashboard + Application settings; local mode unchanged

#### Phase 7: E2B Sandbox Template & MCP Servers
- **`e2b/Dockerfile`** — sandbox template: Ubuntu 22.04 + Goose (block/goose) + Python 3.12 + Node.js 20 + Chromium + OpenHelm browser MCP server (pre-installed with venv at `/opt/openhelm/mcp-servers/browser/.venv`)
- **`e2b/e2b.toml`** — E2B template config: `name = "openhelm-goose"`, 2 vCPU / 4 GB RAM; linked to `Dockerfile`
- **`e2b/build.sh`** — build script: copies `agent/mcp-servers/` into E2B build context, runs `e2b template build`, cleans up; prints post-build instructions for setting `E2B_TEMPLATE_ID` in Fly.io secrets
- **`e2b/.env.example`** — documents `E2B_API_KEY` and `E2B_TEMPLATE_ID` variables
- **`worker/src/executor.ts`** — now writes per-run MCP config (`/tmp/mcp-config.json`) to the sandbox before launching Goose; passes `--mcp-config /tmp/mcp-config.json` flag; sets `GOOSE_PROVIDER`, `GOOSE_MODEL`, `GOOSE_LEAD_MODEL`, and `ANTHROPIC_API_KEY` env vars per-sandbox

### Added (Plan 12, Phases 4–5: Hosted Cloud Deployment)

#### Phase 4: Worker Service
- **`worker/`** — new standalone Node.js service deployed on Fly.io that drives cloud-mode execution
  - `src/scheduler.ts` — 60-second tick loop; queries Supabase for due jobs across all users, enforces per-user concurrency limits, creates run records
  - `src/executor.ts` — E2B sandbox lifecycle: clones project git URL, writes prompt, runs Goose agent, streams output, tears down sandbox on completion
  - `src/stream-relay.ts` — bridges E2B sandbox stdout to Supabase Realtime Broadcast (`run:{runId}` channel) with 5-second batch persistence to `run_logs`
  - `src/llm-router.ts` — direct Anthropic API for chat/planning/assessment (bypasses E2B for operations that don't need file system access)
  - `src/usage-meter.ts` + `src/cost-calculator.ts` — token billing at 20% markup over Anthropic raw rates; normalizes to Haiku-equivalent credits; atomically updates subscription via `increment_used_credits` RPC
  - `src/index.ts` — health endpoint (`GET /health`), action RPC endpoint (`POST /rpc`), crash recovery on startup
  - `Dockerfile` + `fly.toml` — production-ready Fly.io deployment config (London region, shared-cpu-1x, always-on)
- **`supabase/migrations/20260406000004_rpc_functions.sql`** — `increment_used_credits` and `get_usage_summary` Postgres functions with tightly scoped permissions

#### Phase 5: Frontend Transport Layer
- **`src/lib/mode.ts`** — `isLocalMode` / `isCloudMode` flags; detects Tauri vs browser context
- **`src/lib/transport.ts`** — `Transport` interface + lazy singleton `TransportProxy`; all data flows through `transport.request()` and `transport.onEvent()`
- **`src/lib/transport-tauri.ts`** — `TauriTransport` wraps existing `agentClient`; local mode is unchanged
- **`src/lib/transport-supabase.ts`** — `SupabaseTransport` for cloud mode; CRUD via PostgREST, actions via Worker HTTP RPC, events via Supabase Realtime Broadcast
- **`src/lib/transport-supabase-crud.ts`** — full PostgREST dispatch table (projects, goals, jobs, runs, settings, memories, inbox, etc.)
- **`src/lib/supabase-client.ts`** — Supabase anon client singleton; reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- **`src/components/auth/auth-guard.tsx`** — transparent in local mode; requires Supabase auth in cloud mode; shows `LoginPage` until authenticated
- **`src/components/auth/login-page.tsx`** — email/password, Google OAuth, magic link authentication UI (no external auth-ui library dependency)
- **`src/lib/api.ts`** — migrated from `agentClient.request()` to `transport.request()` (150 call sites, mechanical replace)
- **`src/hooks/use-agent-event.ts`** — migrated to `transport.onEvent()` for cross-mode event subscriptions
- **`src/main.tsx`** — wrapped `<App>` with `<AuthGuard>`; cloud mode enforces auth before rendering
- **`src/App.tsx`** — cloud mode skips `agentClient.start()`; sets `agentReady` immediately (AuthGuard already confirmed session)
- **`@supabase/supabase-js`** added to root `package.json`

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
