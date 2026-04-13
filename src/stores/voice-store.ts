/**
 * Zustand store for voice state.
 * Manages session lifecycle, audio capture/playback, and agent event subscriptions.
 */

import { create } from "zustand";
import { agentClient } from "@/lib/agent-client";
import { AudioCapture } from "@/lib/audio-capture";
import { AudioPlayback } from "@/lib/audio-playback";
import * as api from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import type {
  VoiceStatus, TtsEngine, VoiceInteractionMode, PendingAction,
  VoiceStatusEvent, VoiceTranscriptEvent, VoiceTtsChunkEvent, VoiceActionPendingEvent, VoiceErrorEvent,
} from "@openhelm/shared";

export interface VoiceState {
  sessionId: string | null;
  conversationId: string | null;
  status: VoiceStatus;

  // Settings
  ttsEngine: TtsEngine;
  interactionMode: VoiceInteractionMode;
  selectedVoice: string;

  // Audio state
  isRecording: boolean;
  inputLevel: number;         // 0–1 for waveform visualization
  liveTranscript: string;

  // Pending approval
  pendingApproval: { messageId: string; actions: PendingAction[]; spokenSummary: string } | null;

  // Actions
  startSession(projectId: string | null, conversationId?: string): Promise<void>;
  stopRecording(): Promise<void>;
  cancelSession(): void;
  approveAction(decision: "approve" | "reject"): Promise<void>;
  interruptPlayback(): void;
  loadSettings(): Promise<void>;
  updateSettings(params: Partial<{ ttsEngine: TtsEngine; voiceId: string; interactionMode: VoiceInteractionMode }>): Promise<void>;
}

const capture = new AudioCapture();
const playback = new AudioPlayback();
let chunkSeq = 0;
let levelRafId: number | null = null;
// Echo guard: suppress audio forwarding for a period after TTS finishes playing.
// Even after the agent sends "listening", there may be residual speaker echo.
let echoGuardUntil = 0;

function float32ToBase64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 4);
  new Float32Array(buf).set(samples);
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  sessionId: null,
  conversationId: null,
  status: "idle",
  ttsEngine: "piper",
  interactionMode: "conversation",
  selectedVoice: "en_US-lessac-medium",
  isRecording: false,
  inputLevel: 0,
  liveTranscript: "",
  pendingApproval: null,

  async loadSettings() {
    try {
      const s = await api.getVoiceSettings();
      set({ ttsEngine: s.ttsEngine, interactionMode: s.interactionMode, selectedVoice: s.selectedVoice });
      // Pre-warm the mic stream so the AudioWorklet is already initialised
      // before the user clicks the voice button. This prevents the 100–500ms
      // cold-start gap (getUserMedia + addModule) from clipping the start of
      // the first utterance.
      capture.preWarm().catch(() => {
        // Non-fatal: if permission is denied here we'll retry on first voice trigger
      });
    } catch (err) {
      console.error("[voice] loadSettings failed:", err);
    }
  },

  async updateSettings(params) {
    await api.updateVoiceSettings(params);
    await get().loadSettings();
  },

  async startSession(projectId, conversationId) {
    const { interactionMode } = get();

    // Ensure a chat conversation exists on the frontend before starting voice.
    // Voice chat routes through handleChatMessage, which is scoped to a conversation.
    // Without this, the agent creates a new conversation whose ID the frontend
    // doesn't know about — silently filtering all chat.messageCreated events and
    // preventing the thread title from being updated after the session.
    let resolvedConvId = conversationId;
    if (!resolvedConvId) {
      const chatStore = useChatStore.getState();
      if (chatStore.activeConversationId) {
        resolvedConvId = chatStore.activeConversationId;
      } else {
        await chatStore.createThread(projectId);
        resolvedConvId = useChatStore.getState().activeConversationId ?? undefined;
      }
    }

    // Subscribe to voice events from agent
    subscribeToVoiceEvents();

    // Request mic access + start capturing
    chunkSeq = 0;
    // When TTS audio finishes playing, tell the agent so it can resume listening.
    // This replaces the fixed 500ms timer with a real "audio done" signal, preventing
    // the acoustic echo loop where the mic picks up the speaker output.
    playback.onFinished = () => {
      const { sessionId: sid, status } = useVoiceStore.getState();
      if (sid && status === "speaking") {
        // Set a 600ms echo guard so the capture callback suppresses audio even after
        // the agent transitions back to "listening". This absorbs residual speaker
        // echo that the agent-side 600ms delay alone might not fully cover.
        echoGuardUntil = Date.now() + 600;
        api.notifyVoiceTtsPlaybackDone(sid).catch(() => {});
      }
    };

    let sessionId: string;
    try {
      const result = await api.startVoice({ projectId, conversationId: resolvedConvId, mode: interactionMode });
      sessionId = result.sessionId;
    } catch (err) {
      console.error("[voice] failed to start session:", err);
      throw err;
    }

    set({ sessionId, conversationId: resolvedConvId ?? null, status: "listening", isRecording: true, liveTranscript: "", pendingApproval: null });
    echoGuardUntil = 0;

    // Batch audio chunks: AudioWorklet delivers 128-sample frames (~8ms at 16kHz)
    // which would create ~125 IPC calls/sec.  Buffer frames into ~50ms batches
    // (~6 frames) to reduce IPC overhead by 6× without affecting VAD accuracy
    // (VAD silence threshold is 2 000ms; 50ms batching is imperceptible).
    const BATCH_SAMPLES = 800; // ~50ms at 16kHz
    let chunkBatch: Float32Array[] = [];
    let batchSampleCount = 0;

    function flushBatch() {
      if (chunkBatch.length === 0) return;
      const totalLen = chunkBatch.reduce((s, c) => s + c.length, 0);
      const merged = new Float32Array(totalLen);
      let off = 0;
      for (const c of chunkBatch) { merged.set(c, off); off += c.length; }
      chunkBatch = [];
      batchSampleCount = 0;
      const b64 = float32ToBase64(merged);
      agentClient.request("voice.audioChunk", { sessionId, chunk: b64, sequenceNum: chunkSeq++ })
        .catch(() => { /* fire-and-forget */ });
    }

    await capture.start((pcm) => {
      // Only send audio when the agent is actively listening — not during TTS/thinking/etc.
      // This prevents acoustic echo from replaying through the mic during TTS playback.
      const currentStatus = useVoiceStore.getState().status;
      if (currentStatus !== "listening") {
        // Discard any partial batch accumulated during non-listening status
        if (chunkBatch.length > 0) { chunkBatch = []; batchSampleCount = 0; }
        return;
      }
      // Echo guard: skip forwarding audio for a brief period after TTS playback ends
      // to absorb any residual speaker echo even after status returns to "listening".
      if (Date.now() < echoGuardUntil) return;

      chunkBatch.push(pcm);
      batchSampleCount += pcm.length;
      if (batchSampleCount >= BATCH_SAMPLES) {
        flushBatch();
      }
    });

    // Animate input level
    startLevelAnimation();
  },

  async stopRecording() {
    const { sessionId } = get();
    if (!sessionId) return;
    capture.stop();
    stopLevelAnimation();
    set({ isRecording: false, inputLevel: 0 });
    await api.stopVoice({ sessionId });
  },

  cancelSession() {
    const { sessionId } = get();
    capture.stop();
    playback.interrupt();
    stopLevelAnimation();
    set({ sessionId: null, conversationId: null, status: "idle", isRecording: false, inputLevel: 0, liveTranscript: "", pendingApproval: null });
    if (sessionId) {
      api.cancelVoice({ sessionId }).catch(() => { /* ignore */ });
    }
  },

  async approveAction(decision) {
    const { sessionId, pendingApproval } = get();
    if (!sessionId || !pendingApproval) return;
    set({ pendingApproval: null });
    await api.approveVoiceAction({ sessionId, messageId: pendingApproval.messageId, decision });
  },

  interruptPlayback() {
    playback.interrupt();
  },
}));

let eventsSubscribed = false;

function subscribeToVoiceEvents() {
  if (eventsSubscribed) return;
  eventsSubscribed = true;

  window.addEventListener("agent:voice.status", (e: Event) => {
    const { sessionId, status } = (e as CustomEvent<VoiceStatusEvent>).detail;
    const { sessionId: myId, conversationId } = useVoiceStore.getState();
    if (sessionId !== myId) return;
    useVoiceStore.setState({ status: status as VoiceStatus });

    // While the voice LLM is running, mark the chat conversation as "sending"
    // so streaming updates are displayed in the chat panel.
    if (conversationId) {
      if (status === "thinking") {
        useChatStore.getState().setConvSending(conversationId, true);
        // Clear the live transcript once it has been submitted to the LLM.
        // In conversation mode the session never goes "idle" between turns, so
        // liveTranscript would otherwise persist in the chat input field.
        useVoiceStore.setState({ liveTranscript: "" });
      } else if (status !== "transcribing") {
        // LLM done — let chat.messageCreated clear sending, but clear streaming text
        // if going idle/listening so stale text doesn't persist.
        if (status === "idle" || status === "listening") {
          useChatStore.getState().clearConvStreaming(conversationId);
        }
      }
    }

    if (status === "idle") {
      useVoiceStore.getState().cancelSession();
    }
  });

  window.addEventListener("agent:voice.transcript", (e: Event) => {
    const { sessionId, text } = (e as CustomEvent<VoiceTranscriptEvent>).detail;
    const { sessionId: myId } = useVoiceStore.getState();
    if (sessionId !== myId) return;
    useVoiceStore.setState({ liveTranscript: text });
  });

  window.addEventListener("agent:voice.ttsChunk", (e: Event) => {
    const { sessionId, chunk, sampleRate, final } = (e as CustomEvent<VoiceTtsChunkEvent>).detail;
    const { sessionId: myId } = useVoiceStore.getState();
    if (sessionId !== myId) return;
    const samples = base64ToFloat32(chunk);
    playback.enqueue(samples, sampleRate, final);
  });

  window.addEventListener("agent:voice.actionPending", (e: Event) => {
    const { sessionId, messageId, actions, spokenSummary } = (e as CustomEvent<VoiceActionPendingEvent>).detail;
    const { sessionId: myId } = useVoiceStore.getState();
    if (sessionId !== myId) return;
    useVoiceStore.setState({ pendingApproval: { messageId, actions, spokenSummary } });
  });

  window.addEventListener("agent:voice.error", (e: Event) => {
    const { sessionId, error, recoverable } = (e as CustomEvent<VoiceErrorEvent>).detail;
    const { sessionId: myId } = useVoiceStore.getState();
    if (sessionId !== myId) return;
    console.error("[voice] error:", error);
    if (!recoverable) useVoiceStore.getState().cancelSession();
  });
}

function startLevelAnimation() {
  const tick = () => {
    useVoiceStore.setState({ inputLevel: capture.getInputLevel() });
    levelRafId = requestAnimationFrame(tick);
  };
  levelRafId = requestAnimationFrame(tick);
}

function stopLevelAnimation() {
  if (levelRafId !== null) {
    cancelAnimationFrame(levelRafId);
    levelRafId = null;
  }
}
