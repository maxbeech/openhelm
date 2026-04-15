# Plan 13b: Cloud Voice Chat (OpenAI Realtime API)

**Implemented**: April 2026
**Depends on**: Plan 12 (Hosted Cloud Deployment), Plan 13a (Local Voice Chat)
**Tests added**: voice-session.test.ts (270 lines), voice-tool-handler.test.ts (225 lines), usage-meter.test.ts (43 lines)

---

## Overview

Plan 13b adds a voice mode for cloud/browser users. Unlike Plan 13a's chained whisper.cpp → LLM → Piper pipeline, cloud voice uses **OpenAI's Realtime API** — a single WebRTC connection that handles STT, LLM, and TTS natively in one round-trip. This gives sub-300ms latency and natural speech-to-speech feel with no local model downloads required.

The browser connects **directly to OpenAI** via WebRTC (audio never routes through the Fly.io worker), keeping data transfer costs near zero. The worker is only involved in the **control plane**: minting ephemeral tokens, executing tool calls, persisting transcripts, and metering usage.

---

## Architecture

### Local (13a) vs Cloud (13b) Comparison

| | Local (Plan 13a) | Cloud (Plan 13b) |
|---|---|---|
| Runtime | Tauri desktop sidecar | Browser |
| STT | whisper.cpp | OpenAI Realtime (built-in) |
| LLM | Claude via Claude Code CLI | OpenAI Realtime (built-in) |
| TTS | Piper / Kokoro / Coqui | OpenAI Realtime (built-in) |
| Audio path | Mic → agent sidecar → IPC → WebView | Mic → OpenAI → browser (WebRTC) |
| Turn detection | Manual push-to-talk or VAD on agent | Server-side semantic VAD |
| Tool calls | Agent executes locally | Worker executes via worker RPC |
| Cost | Free (local compute) | Metered (audio tokens) |

### Cloud Voice Data Flow

```
Browser mic → WebRTC (audio) → OpenAI Realtime
                                      │
                    ┌─────────────────┼──────────────────┐
                    │                 │                  │
              STT (built-in)   LLM (built-in)    TTS (built-in)
                    │                 │                  │
               transcript        tool calls         audio out
                    │                 │                  │
              worker RPC        worker RPC          WebRTC → <audio>
           voice.persist.turn  voice.tool.execute    element → speakers
```

### Control Plane (Worker Only)

The worker handles these four RPCs:

| Method | Purpose |
|---|---|
| `voice.session.start` | Validate user/demo budget → mint OpenAI ephemeral token → create `voice_sessions` row → return token + session ID |
| `voice.session.end` | Mark session `ended` → record elapsed seconds for demo budget metering |
| `voice.tool.execute` | Execute a tool call issued by OpenAI (read/write project data) → return result |
| `voice.persist.turn` | Write user/assistant transcript turns as `messages` rows in the conversation |
| `voice.meter.report` | Record audio token usage in `usage_records` on `response.done` |

---

## Implementation

### New Files

#### Frontend

| File | Purpose |
|---|---|
| `src/lib/cloud-voice-session.ts` | Orchestrates one cloud voice session: token mint → WebRTC → event dispatch → tool round-trips → persistence |
| `src/lib/cloud-voice-webrtc.ts` | Opens and manages the WebRTC peer connection to OpenAI Realtime. Handles SDP offer/answer, ICE, data channel lifecycle |
| `src/lib/cloud-voice-events.ts` | Parses OpenAI Realtime data-channel events and dispatches matching `agent:voice.*` window events |

#### Worker

| File | Purpose |
|---|---|
| `worker/src/voice/session.ts` | `voice.session.start` / `voice.session.end` handlers. Validates subscription tier or demo budget, mints ephemeral token via OpenAI `/v1/realtime/client_secrets`, creates `voice_sessions` row |
| `worker/src/voice/tool-handler.ts` | `voice.tool.execute` handler. Routes named tool calls to existing data-read/write functions |
| `worker/src/voice/persist-handler.ts` | `voice.persist.turn` handler. Writes user/assistant turns into `messages` and broadcasts `chat.messageCreated` so the text chat panel stays in sync |
| `worker/src/voice/meter-handler.ts` | `voice.meter.report` handler. Records audio token usage via the existing `usage-meter` module |
| `worker/src/voice/instructions.ts` | Builds the Realtime session system prompt. Injects the user's project context, tool schema, and permission-mode rules |

### Modified Files

#### Frontend

| File | Change |
|---|---|
| `src/stores/voice-store.ts` | Added `isCloudMode` branch in `startSession`: cloud path creates a `CloudVoiceSession`; local path unchanged. Added `demoSecondsRemaining` state. Emits matching `agent:voice.*` window events so the same event-subscription code works for both modes |
| `src/components/voice/voice-button.tsx` | Minor: button group class fix |
| `src/components/voice/voice-settings.tsx` | Added cloud-mode voice model selector (gpt-realtime-mini / gpt-realtime) and voice picker |
| `src/lib/transport-supabase.ts` | Added five voice methods to `WORKER_METHODS` so they route to the production worker via `workerRpc` rather than hitting the CRUD handler |

#### Worker

| File | Change |
|---|---|
| `worker/src/index.ts` | Registered five new `voice.*` route cases |
| `worker/src/config.ts` | Added `openaiApiKey: optional("OPENAI_API_KEY", "")` — optional at boot so the worker starts even without voice configured |
| `worker/src/usage-meter.ts` | Extended to handle `voice_input` / `voice_output` call types |
| `worker/src/cost-calculator.ts` | Added Realtime audio token pricing |
| `worker/src/demo-rate-limit.ts` | Added `checkDemoVoiceBudget` / `recordDemoVoiceSeconds` — 60-second per-session audio budget for anonymous demo visitors |

#### Database

| File | Change |
|---|---|
| `supabase/migrations/20260414000004_voice_sessions.sql` | New `voice_sessions` table, FK from `messages.voice_session_id`, `usage_records.call_type` check extension, `demo_rate_limits.voice_seconds_used` column, `increment_demo_voice_seconds` RPC |

---

## Database Schema

### `voice_sessions`

```sql
CREATE TABLE voice_sessions (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id             TEXT          REFERENCES conversations(id) ON DELETE SET NULL,
  model                       TEXT          NOT NULL CHECK (model IN ('gpt-realtime-mini','gpt-realtime')),
  voice                       TEXT          NOT NULL,
  permission_mode             TEXT          NOT NULL,
  status                      TEXT          NOT NULL DEFAULT 'active'
                                               CHECK (status IN ('active','ended','errored')),
  started_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ended_at                    TIMESTAMPTZ,
  openai_session_id           TEXT,
  total_input_audio_tokens    INTEGER       NOT NULL DEFAULT 0,
  total_output_audio_tokens   INTEGER       NOT NULL DEFAULT 0,
  total_cached_input_tokens   INTEGER       NOT NULL DEFAULT 0,
  total_input_text_tokens     INTEGER       NOT NULL DEFAULT 0,
  total_output_text_tokens    INTEGER       NOT NULL DEFAULT 0,
  total_cost_usd              NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_billed_usd            NUMERIC(10,6) NOT NULL DEFAULT 0,
  tool_call_count             INTEGER       NOT NULL DEFAULT 0
);
```

RLS is enabled with a single tenant policy (`user_id = auth.uid()`).

---

## Mode Detection

`src/lib/mode.ts` exports `isCloudMode` as a module-level constant evaluated once at load time:

```ts
export const isLocalMode = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isCloudMode = !isLocalMode;
```

`voice-store.ts` branches on this once in `startSession` — cloud path returns early after setting up `CloudVoiceSession`; local path (whisper + Piper) is unchanged beneath it.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| WebRTC direct browser ↔ OpenAI | Audio never routes through the Fly.io worker, keeping bandwidth costs near zero |
| Ephemeral token with 120s TTL | Short-lived client secret limits exposure; minted immediately before SDP handshake |
| Worker only for control plane | Token mint, tool calls, transcript persistence, and metering all require auth/DB access; audio routing does not |
| Same `agent:voice.*` window events | Cloud and local emit identical custom events so `voice-store.ts` uses one event-subscription code path for both |
| Filler utterances on slow tool calls | After 300ms without a tool result, the model is asked for a brief acknowledgement ("One moment") to avoid dead air |
| Server-side semantic VAD | OpenAI's turn detection handles barge-in automatically — no local audio queue to manage |
| `OPENAI_API_KEY` optional at boot | Worker starts and serves non-voice routes even if the key is absent; `voice.session.start` returns a clear error instead |
| Demo budget: 60s audio per session | Enough for a meaningful demo interaction without significant API cost per anonymous visitor |
| `voice_session_id` FK on messages | Voice turns appear inline in the text chat thread — users can review the transcript after the session ends |

---

## Local Development

Voice calls route through `VITE_WORKER_URL` (set in `.env.local`). In `dev:cloud` mode this is the production worker at `https://openhelm-worker.fly.dev`, so voice works out of the box without local secrets.

To test worker voice changes locally, use `npm run dev:cloud:full` and add to `.env.local`:

```
OPENAI_API_KEY=sk-...
SUPABASE_SERVICE_KEY=eyJ...
```

The `OPENAI_API_KEY` fly secret must be set on the production worker for voice to work in production:

```bash
fly secrets set OPENAI_API_KEY=sk-... --app openhelm-worker
```
