/**
 * IPC handlers for the voice pipeline.
 * Maps voice.* methods to VoiceSession operations.
 */

import { registerHandler } from "../handler.js";
import {
  createSession,
  getSession,
  removeSession,
} from "../../voice/index.js";
import { getSetting, setSetting } from "../../db/queries/settings.js";
import type {
  StartVoiceParams,
  VoiceAudioChunkParams,
  StopVoiceParams,
  CancelVoiceParams,
  VoiceApproveParams,
  UpdateVoiceSettingsParams,
  GetVoiceSettingsResult,
  TtsEngine,
  VoiceInteractionMode,
} from "@openhelm/shared";

function normaliseProjectId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

export function registerVoiceHandlers(): void {
  // Start a new voice session
  registerHandler("voice.start", (params) => {
    const p = params as StartVoiceParams;
    const projectId = normaliseProjectId(p?.projectId);
    const session = createSession({
      projectId,
      conversationId: p?.conversationId || undefined,
      mode: p?.mode || "conversation",
    });
    return { sessionId: session.sessionId, started: true };
  });

  // Receive an audio chunk from the frontend
  registerHandler("voice.audioChunk", (params) => {
    const p = params as VoiceAudioChunkParams;
    if (!p?.sessionId) throw new Error("sessionId is required");
    if (!p?.chunk) throw new Error("chunk is required");
    const session = getSession(p.sessionId);
    if (!session) return { received: false, reason: "session_not_found" };
    session.receiveAudioChunk(p.chunk);
    return { received: true };
  });

  // Stop recording and trigger transcription
  registerHandler("voice.stop", async (params) => {
    const p = params as StopVoiceParams;
    if (!p?.sessionId) throw new Error("sessionId is required");
    const session = getSession(p.sessionId);
    if (!session) return { stopped: false, reason: "session_not_found" };
    await session.stop();
    return { stopped: true };
  });

  // Frontend signals that TTS audio has finished playing — agent can resume listening
  registerHandler("voice.ttsPlaybackDone", (params) => {
    const p = params as { sessionId: string };
    if (!p?.sessionId) return { ok: false };
    const session = getSession(p.sessionId);
    if (session) session.onTtsPlaybackDone();
    return { ok: true };
  });

  // Cancel session entirely
  registerHandler("voice.cancel", (params) => {
    const p = params as CancelVoiceParams;
    if (!p?.sessionId) throw new Error("sessionId is required");
    const session = getSession(p.sessionId);
    if (session) {
      session.cancel();
      removeSession(p.sessionId);
    }
    return { cancelled: true };
  });

  // Approve or reject a pending write action
  registerHandler("voice.approve", async (params) => {
    const p = params as VoiceApproveParams;
    if (!p?.sessionId) throw new Error("sessionId is required");
    if (!p?.messageId) throw new Error("messageId is required");
    if (!p?.decision) throw new Error("decision is required");
    const session = getSession(p.sessionId);
    if (!session) return { ok: false, reason: "session_not_found" };
    await session.approve(p.messageId, p.decision);
    return { ok: true };
  });

  // Get current voice settings
  registerHandler("voice.getSettings", (): GetVoiceSettingsResult => {
    const ttsEngine = (getSetting("voice_tts_engine")?.value as TtsEngine) ?? "piper";
    const interactionMode = (getSetting("voice_interaction_mode")?.value as VoiceInteractionMode) ?? "conversation";
    const selectedVoice = getSetting("voice_selected_voice")?.value ?? "en_US-lessac-medium";
    const enabled = getSetting("voice_enabled")?.value !== "false";
    return { ttsEngine, interactionMode, selectedVoice, enabled };
  });

  // Update voice settings
  registerHandler("voice.updateSettings", (params) => {
    const p = params as UpdateVoiceSettingsParams;
    if (p?.ttsEngine) setSetting("voice_tts_engine", p.ttsEngine);
    if (p?.interactionMode) setSetting("voice_interaction_mode", p.interactionMode);
    if (p?.voiceId) setSetting("voice_selected_voice", p.voiceId);
    return { updated: true };
  });
}
