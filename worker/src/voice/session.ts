/**
 * Voice session handler.
 *
 * POST /rpc voice.session.start
 *   - Validates subscription tier or demo budget
 *   - Builds system prompt + tool schema
 *   - Mints an OpenAI Realtime client secret via POST /v1/realtime/client_secrets
 *   - Creates a voice_sessions row so subsequent tool / persist / meter calls
 *     have something to attribute usage to
 *   - Returns { ephemeralToken, voiceSessionId, model, voice, expiresAt }
 *
 * POST /rpc voice.session.end
 *   - Marks the session as 'ended'
 *   - For demo sessions, records the measured audio seconds against the
 *     per-session budget (caller reports seconds as measured client-side)
 */

import { config } from "../config.js";
import { getSupabase } from "../supabase.js";
import { buildVoiceInstructions } from "./instructions.js";
import { getToolsForMode } from "../chat/tool-schemas.js";
import {
  DemoRateLimitError,
  checkDemoVoiceBudget,
  recordDemoVoiceSeconds,
} from "../demo-rate-limit.js";

export type VoiceModel = "gpt-realtime-mini" | "gpt-realtime";

const DEFAULT_VOICE_MODEL: VoiceModel = "gpt-realtime-mini";
const DEFAULT_VOICE = "marin";
const ALLOWED_VOICES = [
  "marin",
  "cedar",
  "ash",
  "verse",
  "coral",
  "shimmer",
  "ballad",
  "sage",
  "alloy",
  "echo",
] as const;
type Voice = (typeof ALLOWED_VOICES)[number];

/** Default ephemeral token lifetime. Long enough to cover ~1 min of user reaction + SDP handshake. */
const EPHEMERAL_TTL_SECONDS = 120;

export interface VoiceSessionStartParams {
  conversationId?: string;
  model?: VoiceModel;
  voice?: Voice;
  permissionMode?: string;
  demoSlug?: string;
}

export interface VoiceSessionStartResult {
  voiceSessionId: string;
  ephemeralToken: string;
  openaiSessionId: string | null;
  model: VoiceModel;
  voice: Voice;
  expiresAt: string;
  secondsRemaining: number | null;
}

export interface VoiceRpcContext {
  authUserId: string;
  isAnonymous: boolean;
  clientIpHash: string;
}

/** Convert chat tool schemas to the Realtime session.tools shape. */
function toRealtimeTools(
  tools: ReturnType<typeof getToolsForMode>,
): Array<{
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
}> {
  return tools
    .filter((t): t is Extract<typeof t, { type: "function" }> => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as unknown,
    }));
}

export async function handleVoiceSessionStart(
  params: VoiceSessionStartParams,
  ctx: VoiceRpcContext,
): Promise<VoiceSessionStartResult> {
  if (!config.openaiApiKey) {
    throw new Error("voice_not_configured: OPENAI_API_KEY is not set on the worker");
  }

  const model: VoiceModel =
    params.model === "gpt-realtime" ? "gpt-realtime" : DEFAULT_VOICE_MODEL;
  const voice: Voice = (ALLOWED_VOICES as readonly string[]).includes(params.voice ?? "")
    ? (params.voice as Voice)
    : DEFAULT_VOICE;

  // Demo visitors: anonymous users on a /demo/:slug page. Force plan mode
  // (read-only) so the tool whitelist used by /voice/tool can't be expanded.
  let effectiveMode = params.permissionMode ?? "plan";
  let secondsRemaining: number | null = null;
  if (ctx.isAnonymous) {
    if (!params.demoSlug) {
      throw new Error("voice_requires_demo_slug");
    }
    effectiveMode = "plan";
    const budget = await checkDemoVoiceBudget({
      sessionId: ctx.authUserId,
      slug: params.demoSlug,
    });
    if (!budget.ok) {
      throw new DemoRateLimitError(budget.reason);
    }
    secondsRemaining = budget.secondsRemaining;
  }

  // Build system prompt + tool catalogue. These are the biggest cost drivers
  // per session, so they're set once and then cached by OpenAI's prompt cache.
  const instructions = await buildVoiceInstructions(effectiveMode, ctx.authUserId);
  const tools = toRealtimeTools(getToolsForMode(effectiveMode));

  // Persist session row BEFORE minting the token so a worker crash between
  // the two doesn't leak ephemeral tokens.
  const supabase = getSupabase();
  const voiceSessionId = crypto.randomUUID();
  const { error: insertErr } = await supabase.from("voice_sessions").insert({
    id: voiceSessionId,
    user_id: ctx.authUserId,
    conversation_id: params.conversationId ?? null,
    model,
    voice,
    permission_mode: effectiveMode,
    status: "active",
    started_at: new Date().toISOString(),
  });
  if (insertErr) {
    throw new Error(`[voice-session] insert failed: ${insertErr.message}`);
  }

  // Mint the OpenAI Realtime ephemeral token. The session shape follows the
  // current (Apr 2026) `session.update` schema: voice/format are nested
  // under `audio.output`, input format/transcription/VAD are nested under
  // `audio.input`. The browser can in principle mutate these post-connection
  // — /voice/tool enforces a server-side whitelist on every tool call
  // regardless.
  const clientSecretRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: EPHEMERAL_TTL_SECONDS },
      session: {
        type: "realtime",
        model,
        instructions,
        tools,
        tool_choice: "auto",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice,
            format: { type: "audio/pcm", rate: 24000 },
          },
        },
      },
    }),
  });

  if (!clientSecretRes.ok) {
    const errText = await clientSecretRes.text().catch(() => "");
    await supabase
      .from("voice_sessions")
      .update({ status: "errored", ended_at: new Date().toISOString() })
      .eq("id", voiceSessionId);
    throw new Error(
      `openai_client_secret_failed: HTTP ${clientSecretRes.status} ${errText.slice(0, 200)}`,
    );
  }

  const body = (await clientSecretRes.json()) as {
    value?: string;
    client_secret?: { value?: string };
    expires_at?: number;
    session?: { id?: string };
  };
  // The response shape has shifted during the beta — accept either the
  // flat `value` form or the nested `client_secret.value` form.
  const ephemeralToken = body.value ?? body.client_secret?.value;
  if (!ephemeralToken) {
    await supabase
      .from("voice_sessions")
      .update({ status: "errored", ended_at: new Date().toISOString() })
      .eq("id", voiceSessionId);
    throw new Error("openai_client_secret_missing_value");
  }

  const openaiSessionId = body.session?.id ?? null;
  if (openaiSessionId) {
    await supabase
      .from("voice_sessions")
      .update({ openai_session_id: openaiSessionId })
      .eq("id", voiceSessionId);
  }

  const expiresAt = body.expires_at
    ? new Date(body.expires_at * 1000).toISOString()
    : new Date(Date.now() + EPHEMERAL_TTL_SECONDS * 1000).toISOString();

  return {
    voiceSessionId,
    ephemeralToken,
    openaiSessionId,
    model,
    voice,
    expiresAt,
    secondsRemaining,
  };
}

export interface VoiceSessionEndParams {
  voiceSessionId: string;
  elapsedSeconds?: number;
  demoSlug?: string;
}

export async function handleVoiceSessionEnd(
  params: VoiceSessionEndParams,
  ctx: VoiceRpcContext,
): Promise<{ ended: true }> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: session, error: fetchErr } = await supabase
    .from("voice_sessions")
    .select("id, user_id, permission_mode")
    .eq("id", params.voiceSessionId)
    .eq("user_id", ctx.authUserId)
    .single();

  if (fetchErr || !session) {
    throw new Error("voice_session_not_found");
  }

  await supabase
    .from("voice_sessions")
    .update({ status: "ended", ended_at: now })
    .eq("id", params.voiceSessionId);

  // For demo sessions, record the elapsed time against the per-session budget
  // so the next /voice/session.start call sees the updated remaining budget.
  if (ctx.isAnonymous && params.demoSlug && params.elapsedSeconds && params.elapsedSeconds > 0) {
    await recordDemoVoiceSeconds({
      sessionId: ctx.authUserId,
      ipHash: ctx.clientIpHash,
      slug: params.demoSlug,
      seconds: params.elapsedSeconds,
    });
  }

  return { ended: true };
}
