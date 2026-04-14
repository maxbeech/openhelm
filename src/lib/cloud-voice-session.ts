/**
 * CloudVoiceSession — orchestrates a single cloud voice turn lifecycle.
 *
 * One instance per active session. Owns:
 *   - The WebRTC peer connection to OpenAI Realtime (via cloud-voice-webrtc)
 *   - Event dispatch from the data channel (via cloud-voice-events)
 *   - Tool call round-tripping through the worker (/rpc voice.tool.execute)
 *   - Transcript persistence (/rpc voice.persist.turn)
 *   - Usage metering (/rpc voice.meter.report) on response.done
 *   - Filler utterance scheduling for slow tool calls
 *
 * Status updates are emitted as `agent:voice.*` window events so the existing
 * voice-store subscription code keeps working unchanged across local + cloud.
 */

import { transport } from "./transport.js";
import {
  openOpenRealtimeConnection,
  type OpenRealtimeConnection,
} from "./cloud-voice-webrtc.js";
import { dispatchRealtimeEvent, type RealtimeUsage } from "./cloud-voice-events.js";
import type { VoiceStatus } from "@openhelm/shared";

const FILLER_DELAY_MS = 300;

export interface CloudVoiceSessionOptions {
  projectId: string | null;
  conversationId: string | null;
  model?: "gpt-realtime-mini" | "gpt-realtime";
  voice?: string;
  permissionMode?: string;
  demoSlug?: string;
}

export interface CloudVoiceStartResult {
  voiceSessionId: string;
  ephemeralToken: string;
  openaiSessionId: string | null;
  model: "gpt-realtime-mini" | "gpt-realtime";
  voice: string;
  expiresAt: string;
  secondsRemaining: number | null;
}

export class CloudVoiceSession {
  private connection: OpenRealtimeConnection | null = null;
  private voiceSessionId: string | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private startedAt = 0;
  private disposed = false;
  /** Accumulates assistant transcript deltas between speech boundaries. */
  private runningOutputTranscript = "";

  constructor(private readonly opts: CloudVoiceSessionOptions) {}

  async start(): Promise<{ voiceSessionId: string; secondsRemaining: number | null }> {
    // 1. Ask the worker to mint an ephemeral token + persist a voice_sessions row.
    const result = await transport.request<CloudVoiceStartResult>("voice.session.start", {
      conversationId: this.opts.conversationId ?? undefined,
      model: this.opts.model,
      voice: this.opts.voice,
      permissionMode: this.opts.permissionMode,
      demoSlug: this.opts.demoSlug,
    });
    this.voiceSessionId = result.voiceSessionId;

    // 2. Set up a hidden <audio> element to play incoming assistant audio.
    //    We attach it to the DOM so WKWebView/Safari autoplay policies don't
    //    block playback. Hidden via CSS from outside.
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.style.position = "fixed";
    audio.style.left = "-9999px";
    audio.style.top = "-9999px";
    document.body.appendChild(audio);
    this.audioElement = audio;

    // 3. Open the WebRTC peer connection.
    this.connection = await openOpenRealtimeConnection({
      ephemeralToken: result.ephemeralToken,
      model: result.model,
      audioElement: audio,
      onEvent: (event) => this.handleEvent(event),
      onDisconnected: (reason) => this.handleDisconnect(reason),
    });

    this.startedAt = Date.now();
    this.emitStatus("listening");
    return { voiceSessionId: result.voiceSessionId, secondsRemaining: result.secondsRemaining };
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const elapsed = this.startedAt > 0 ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    const sessionId = this.voiceSessionId;

    this.connection?.close();
    this.connection = null;

    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.srcObject = null;
        this.audioElement.remove();
      } catch { /* ignore */ }
      this.audioElement = null;
    }

    this.emitStatus("idle");

    // Notify the worker so it can close the voice_sessions row and meter
    // the demo voice budget for anonymous visitors.
    if (sessionId) {
      try {
        await transport.request("voice.session.end", {
          voiceSessionId: sessionId,
          elapsedSeconds: elapsed,
          demoSlug: this.opts.demoSlug,
        });
      } catch (err) {
        console.error("[cloud-voice] session.end failed:", err);
      }
    }
  }

  cancel(): void {
    if (this.disposed) return;
    void this.stop();
  }

  // ─── Event dispatch ─────────────────────────────────────────────────────

  private handleEvent(event: unknown): void {
    if (this.disposed) return;
    dispatchRealtimeEvent(event, {
      onSessionCreated: () => {
        // The openai_session_id is already stored during session.start via the
        // minting call; no need to round-trip it again here.
      },
      onSpeechStarted: () => {
        // User started talking — either they interrupted the assistant or
        // started a new turn. Either way, surface as "listening".
        this.emitStatus("listening");
      },
      onSpeechStopped: () => {
        this.emitStatus("transcribing");
      },
      onInputTranscriptCompleted: (text) => {
        this.emitTranscript(text, false);
        this.emitStatus("thinking");
        // Persist the user turn as a chat message. Fire-and-forget —
        // broadcast will surface it in the text chat view.
        void this.persistTurn("user", text);
      },
      onInputTranscriptFailed: (message) => {
        console.warn("[cloud-voice] input transcription failed:", message);
      },
      onResponseCreated: () => {
        this.runningOutputTranscript = "";
        this.emitStatus("speaking");
      },
      onOutputTranscriptDelta: (delta) => {
        this.runningOutputTranscript += delta;
      },
      onOutputTranscriptDone: (fullText) => {
        const finalText = fullText || this.runningOutputTranscript;
        if (finalText) {
          void this.persistTurn("assistant", finalText);
        }
        this.runningOutputTranscript = "";
      },
      onFunctionCallDone: (call) => {
        void this.handleFunctionCall(call.callId, call.name, call.arguments);
      },
      onResponseDone: (usage) => {
        if (usage) void this.reportUsage(usage);
        // Return to listening so the user can speak again. speech_started
        // will fire again on their next utterance.
        this.emitStatus("listening");
      },
      onError: (err) => {
        console.error("[cloud-voice] session error:", err);
        this.emitError(err.message ?? "session_error", true);
      },
    });
  }

  // ─── Tool calls ─────────────────────────────────────────────────────────

  private async handleFunctionCall(
    callId: string,
    name: string,
    rawArguments: string,
  ): Promise<void> {
    if (!this.voiceSessionId || !this.connection) return;

    // Kick off a filler utterance after a short delay so slow tool calls
    // don't feel dead. The model will honour the instructions_override by
    // saying a very short acknowledgement, then stop when the real
    // function_call_output + response.create arrives.
    let fillerFired = false;
    const fillerTimer = window.setTimeout(() => {
      if (this.disposed || !this.connection) return;
      fillerFired = true;
      this.connection.send({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions:
            "Say a very brief acknowledgement like 'One moment' or 'Let me check that', then stop. Do not describe what you're doing.",
        },
      });
    }, FILLER_DELAY_MS);

    let output: unknown;
    try {
      const result = await transport.request<{ callId: string; result: unknown }>(
        "voice.tool.execute",
        {
          voiceSessionId: this.voiceSessionId,
          callId,
          name,
          arguments: rawArguments,
        },
      );
      output = result.result;
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
    } finally {
      window.clearTimeout(fillerTimer);
    }

    if (this.disposed || !this.connection) return;

    // Send the function_call_output item, then a separate response.create.
    // Both are required — without response.create the model stays silent.
    this.connection.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output ?? {}),
      },
    });
    this.connection.send({ type: "response.create" });

    // If a filler was already playing, the response.create above will queue
    // the real answer after it. The model handles that sequencing internally.
    void fillerFired;
  }

  // ─── Persistence & metering ─────────────────────────────────────────────

  private async persistTurn(
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    if (!this.voiceSessionId) return;
    try {
      await transport.request("voice.persist.turn", {
        voiceSessionId: this.voiceSessionId,
        role,
        content,
      });
    } catch (err) {
      // Non-fatal — voice session continues even if persistence fails.
      console.warn("[cloud-voice] persist turn failed:", err);
    }
  }

  private async reportUsage(usage: RealtimeUsage): Promise<void> {
    if (!this.voiceSessionId) return;
    try {
      await transport.request("voice.meter.report", {
        voiceSessionId: this.voiceSessionId,
        inputAudioTokens: usage.inputAudioTokens,
        cachedInputAudioTokens: usage.cachedInputAudioTokens,
        outputAudioTokens: usage.outputAudioTokens,
        inputTextTokens: usage.inputTextTokens,
        outputTextTokens: usage.outputTextTokens,
      });
    } catch (err) {
      console.warn("[cloud-voice] meter report failed:", err);
    }
  }

  // ─── Window event emission (mirror of agent-side emit) ──────────────────

  private emitStatus(status: VoiceStatus): void {
    this.dispatch("voice.status", { sessionId: this.voiceSessionId ?? "", status });
  }

  private emitTranscript(text: string, interim: boolean): void {
    this.dispatch("voice.transcript", {
      sessionId: this.voiceSessionId ?? "",
      text,
      interim,
    });
  }

  private emitError(message: string, recoverable: boolean): void {
    this.dispatch("voice.error", {
      sessionId: this.voiceSessionId ?? "",
      error: message,
      recoverable,
    });
  }

  private dispatch(eventName: string, detail: unknown): void {
    window.dispatchEvent(new CustomEvent(`agent:${eventName}`, { detail }));
  }

  private handleDisconnect(reason: string): void {
    if (this.disposed) return;
    console.warn("[cloud-voice] disconnected:", reason);
    this.emitError(`disconnected: ${reason}`, false);
    void this.stop();
  }
}
