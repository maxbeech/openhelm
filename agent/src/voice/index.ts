/**
 * Voice session registry and startup helpers.
 * VoiceSession class lives in ./session.ts.
 */

import { getSetting } from "../db/queries/settings.js";
import { VoiceSession } from "./session.js";
import type { VoiceSessionOptions } from "./session.js";

export { VoiceSession } from "./session.js";
export type { VoiceSessionOptions, VoiceSessionStatus } from "./session.js";

// ─── Session registry ───────────────────────────────────────────────────────
// Only one session is active at a time. A new createSession() call cancels
// any previously running session.

const sessions = new Map<string, VoiceSession>();

export function createSession(opts: VoiceSessionOptions): VoiceSession {
  // Cancel any existing session (only one active at a time)
  for (const [id, session] of sessions) {
    session.cancel();
    sessions.delete(id);
  }
  const session = new VoiceSession(opts);
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): VoiceSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ─── Startup pre-warming ────────────────────────────────────────────────────

/** Pre-warm the whisper model at startup (non-blocking) */
export async function preWarmWhisper(): Promise<void> {
  try {
    const { LocalVoiceProvider } = await import("./local-stt.js");
    const voiceEnabled = getSetting("voice_enabled")?.value;
    if (voiceEnabled === "false") return;
    const provider = new LocalVoiceProvider("piper");
    await provider.preload();
  } catch (err) {
    // Non-fatal: voice may not be used, or smart-whisper not installed yet
    console.error("[voice] pre-warm skipped:", err);
  }
}
