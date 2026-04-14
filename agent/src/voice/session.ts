/**
 * VoiceSession — orchestrates one complete voice-turn lifecycle:
 *   audio input → STT → handleChatMessage → sentence splitter → TTS → audio output
 *
 * One session per active voice interaction. Sessions are keyed by sessionId and
 * managed by the voice IPC handler (via the registry in voice/index.ts).
 */

import { randomUUID } from "crypto";
import { handleChatMessage } from "../chat/handler.js";
import { createVoiceProvider } from "./provider.js";
import { Vad } from "./vad.js";
import { SentenceSplitter } from "./sentence-splitter.js";
import {
  base64ToFloat32, mergeFloat32Chunks,
  float32ToBase64,
} from "./audio-utils.js";
import { emit } from "../ipc/emitter.js";
import { getSetting } from "../db/queries/settings.js";
import type { TtsEngine, VoiceInteractionMode, PendingAction } from "@openhelm/shared";

const DEFAULT_TTS_ENGINE: TtsEngine = "piper";
const DEFAULT_MODE: VoiceInteractionMode = "conversation";

export interface VoiceSessionOptions {
  projectId: string | null;
  conversationId?: string;
  mode?: VoiceInteractionMode;
}

export type VoiceSessionStatus =
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "awaiting-approval"
  | "idle";

export class VoiceSession {
  readonly sessionId: string;
  private readonly projectId: string | null;
  private readonly conversationId: string | undefined;
  private readonly mode: VoiceInteractionMode;

  private status: VoiceSessionStatus = "listening";
  private audioChunks: Float32Array[] = [];
  private abortController = new AbortController();
  private vad: Vad;
  private ttsSeqNum = 0;
  private pendingApproval: { messageId: string; actions: PendingAction[]; spokenSummary: string } | null = null;
  private disposed = false;

  constructor(opts: VoiceSessionOptions) {
    this.sessionId = randomUUID();
    this.projectId = opts.projectId;
    this.conversationId = opts.conversationId;
    this.mode = opts.mode ?? DEFAULT_MODE;

    this.vad = new Vad({
      onSpeechEnd: () => {
        // VAD detected end of speech — trigger transcription
        if (this.status === "listening") {
          setImmediate(() => this.triggerTranscription().catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[voice] transcription error:", msg, err instanceof Error ? err.stack : "");
            this.emitError(msg, false);
          }));
        }
      },
    });

    this.emitStatus("listening");
  }

  /** Receive a base64-encoded PCM audio chunk from the frontend */
  receiveAudioChunk(b64Chunk: string): void {
    if (this.status !== "listening" || this.disposed) return;
    const samples = base64ToFloat32(b64Chunk);
    this.audioChunks.push(samples);
    if (this.mode === "conversation") {
      this.vad.process(samples);
    }
  }

  /** Manually stop recording and trigger transcription (push-to-talk or manual stop) */
  async stop(): Promise<void> {
    if (this.status !== "listening" || this.disposed) return;
    await this.triggerTranscription();
  }

  /** Cancel session immediately — abort any in-flight LLM call */
  cancel(): void {
    this.abortController.abort();
    this.disposed = true;
    this.emitStatus("idle");
  }

  /** Approve/reject a pending write action */
  async approve(messageId: string, decision: "approve" | "reject"): Promise<void> {
    if (!this.pendingApproval || this.pendingApproval.messageId !== messageId) return;
    this.pendingApproval = null;
    if (decision === "approve") {
      // Delegate to the existing chat approval mechanism via IPC
      emit("voice.approvalResult", { sessionId: this.sessionId, messageId, decision });
    }
    // After approval/rejection, go back to listening in conversation mode
    if (this.mode === "conversation") {
      this.vad.reset();
      this.audioChunks = [];
      this.emitStatus("listening");
    } else {
      this.emitStatus("idle");
    }
  }

  private async triggerTranscription(): Promise<void> {
    if (this.audioChunks.length === 0) {
      this.emitStatus("listening");
      return;
    }

    this.emitStatus("transcribing");
    const engine = this.getTtsEngine();
    const provider = await createVoiceProvider(engine);

    try {
      const merged = mergeFloat32Chunks(this.audioChunks);
      this.audioChunks = [];
      this.vad.reset();

      // smart-whisper takes Float32 PCM directly (not WAV)
      const { text } = await provider.transcribe(merged);

      // Strip Whisper hallucination tokens (output on silence/noise: [BLANK_AUDIO],
      // [Pause], [typing sounds], etc.) and segment-number prefixes ("-1. ", "1. ").
      const cleaned = text
        .replace(/\[.*?\]/g, "")          // [BLANK_AUDIO], [Pause], [typing sounds]…
        .replace(/\(.*?\)/g, "")          // (nothing) variants
        .replace(/^\s*-?\d+[.)]\s*/u, "") // leading "1." or "-1." segment markers
        .trim();

      if (!cleaned) {
        // Empty or hallucination-only transcription — go back to listening silently
        console.error("[voice] whisper hallucination filtered:", JSON.stringify(text));
        this.emitStatus("listening");
        return;
      }

      emit("voice.transcript", { sessionId: this.sessionId, text: cleaned, interim: false });
      this.emitStatus("thinking");

      await this.runLlm(cleaned, provider);
    } finally {
      provider.dispose();
    }
  }

  private async runLlm(userText: string, provider: Awaited<ReturnType<typeof createVoiceProvider>>): Promise<void> {
    // Streaming TTS overlap: sentences are synthesised as the LLM streams, not after it
    // finishes. handleChatMessage fires onStreamingText with the full cumulative sanitized
    // text on every chunk. We diff against what we've already seen to get the delta, push
    // the delta into the SentenceSplitter, and immediately chain a synthesis task for each
    // complete sentence that emerges. Synthesis tasks are chained sequentially on synthChain
    // so sentences always play in arrival order regardless of individual synthesis durations.
    let lastSeenTextLen = 0;
    let synthChain: Promise<void> = Promise.resolve();
    // Set to true if handleChatMessage throws, so queued synth tasks bail out
    // without emitting stale TTS chunks to a session that's about to go idle/error.
    let synthAborted = false;

    const splitter = new SentenceSplitter({
      onSentence: (sentence) => {
        // Chain onto previous synthesis promise to guarantee ordered playback
        synthChain = synthChain.then(async () => {
          if (this.disposed || this.abortController.signal.aborted || synthAborted) return;
          await this.synthesizeSentence(sentence, provider).catch((err) =>
            console.error("[voice] tts error:", err));
        });
      },
    });

    let messages: Awaited<ReturnType<typeof handleChatMessage>>;
    try {
      messages = await handleChatMessage(
        this.projectId,
        userText,
        undefined,
        undefined,
        undefined,
        "plan",
        this.conversationId,
        this.abortController.signal,
        (fullText) => {
          // Compute delta: only the text we haven't fed to the splitter yet
          if (fullText.length > lastSeenTextLen) {
            splitter.push(fullText.slice(lastSeenTextLen));
            lastSeenTextLen = fullText.length;
          }
        },
      );
    } catch (err) {
      synthAborted = true;
      throw err;
    }

    // Flush any partial sentence remaining after LLM stream ends
    splitter.end();

    // Wait for all queued sentence synthesis to complete
    await synthChain;

    // Emit session-level final sentinel: empty samples + final=true.
    // AudioPlayback.onFinished only fires when it receives this AND all
    // previously enqueued audio nodes have drained.
    emit("voice.ttsChunk", {
      sessionId: this.sessionId,
      chunk: float32ToBase64(new Float32Array(0)),
      sampleRate: 22050,
      sequenceNum: this.ttsSeqNum++,
      final: true,
    });

    // Check for pending actions
    const assistantMsg = messages.find((m) => m.role === "assistant");
    if (assistantMsg?.pendingActions?.length) {
      const spokenSummary = buildSpokenSummary(assistantMsg.pendingActions);
      this.pendingApproval = {
        messageId: assistantMsg.id,
        actions: assistantMsg.pendingActions,
        spokenSummary,
      };
      this.emitStatus("awaiting-approval");
      emit("voice.actionPending", {
        sessionId: this.sessionId,
        messageId: assistantMsg.id,
        actions: assistantMsg.pendingActions,
        spokenSummary,
      });
      // For awaiting-approval: no fallback timer — session waits for user input.
    } else {
      // Schedule fallback in case ttsPlaybackDone is never received.
      // Timer starts AFTER synthesis is done so it only covers the actual playback
      // window, preventing premature mic-open during TTS.
      this.scheduleListenAfterTts();
    }
  }

  private async synthesizeSentence(sentence: string, provider: Awaited<ReturnType<typeof createVoiceProvider>>): Promise<void> {
    this.emitStatus("speaking");
    const voice = getSetting("voice_selected_voice")?.value ?? "";
    await provider.synthesize(sentence, { voice: voice || undefined }, (chunk) => {
      // Always emit final=false per sentence — the session-level final sentinel is
      // sent separately in runLlm() after ALL sentences are synthesised.
      // This prevents AudioPlayback.onFinished from firing prematurely when a
      // short sentence finishes playing before the next sentence's audio arrives.
      if (chunk.samples.length === 0) return; // Drop empty per-sentence flush chunks
      const seqNum = this.ttsSeqNum++;
      emit("voice.ttsChunk", {
        sessionId: this.sessionId,
        chunk: float32ToBase64(chunk.samples),
        sampleRate: chunk.sampleRate,
        sequenceNum: seqNum,
        final: false,
      });
    });
  }

  /** Called by the IPC handler when the frontend signals TTS audio has finished playing. */
  onTtsPlaybackDone(): void {
    if (!this.disposed && this.status === "speaking") {
      // 600ms delay to let speaker echo decay before the mic re-opens.
      // (Increased from 300ms — 300ms was too short for MacBook internal speakers
      // and caused the tail of TTS audio to be picked up by the mic, triggering a
      // second transcription of the same answer.)
      setTimeout(() => {
        if (!this.disposed && this.status === "speaking") {
          this.audioChunks = [];
          this.vad.reset();
          this.emitStatus(this.mode === "conversation" ? "listening" : "idle");
        }
      }, 600);
    }
  }

  private scheduleListenAfterTts(): void {
    // Safety fallback: if the frontend never sends voice.ttsPlaybackDone (e.g. the
    // AudioContext was closed, or the app was backgrounded), transition after a
    // generous timeout. This timer starts AFTER synthesis is complete so it only
    // covers the actual playback window.
    setTimeout(() => {
      if (!this.disposed && this.status === "speaking") {
        this.audioChunks = [];
        this.vad.reset();
        this.emitStatus(this.mode === "conversation" ? "listening" : "idle");
      }
    }, 12000);
  }

  private getTtsEngine(): TtsEngine {
    const setting = getSetting("voice_tts_engine")?.value;
    if (setting === "piper" || setting === "kokoro" || setting === "coqui-xtts") return setting;
    return DEFAULT_TTS_ENGINE;
  }

  private emitStatus(status: VoiceSessionStatus): void {
    this.status = status;
    emit("voice.status", { sessionId: this.sessionId, status });
  }

  private emitError(message: string, recoverable: boolean): void {
    emit("voice.error", { sessionId: this.sessionId, error: message, recoverable });
    this.emitStatus("idle");
  }
}

function buildSpokenSummary(actions: PendingAction[]): string {
  if (actions.length === 1) {
    return `I'd like to ${actions[0].description}. Should I go ahead?`;
  }
  const items = actions.map((a) => a.description).join(", ");
  return `I'd like to perform ${actions.length} actions: ${items}. Should I go ahead?`;
}
