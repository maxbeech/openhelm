/**
 * Typed wrapper around the OpenAI Realtime event stream.
 *
 * The server sends newline-delimited JSON events over the "oai-events"
 * RTCDataChannel. This module classifies them into a handful of typed
 * handlers so cloud-voice-session.ts stays readable without a giant
 * switch statement.
 *
 * We deliberately model only the events we care about — everything else
 * is dropped on the floor. OpenAI adds new event types across model
 * updates and we don't want to fail on unknowns.
 */

/** The subset of Realtime events we handle. */
export type RealtimeEventName =
  | "session.created"
  | "session.updated"
  | "conversation.item.created"
  | "conversation.item.input_audio_transcription.completed"
  | "conversation.item.input_audio_transcription.failed"
  | "input_audio_buffer.speech_started"
  | "input_audio_buffer.speech_stopped"
  | "response.created"
  | "response.output_audio_transcript.delta"
  | "response.output_audio_transcript.done"
  // Older event aliases (different model revisions) — handled equivalently.
  | "response.audio_transcript.delta"
  | "response.audio_transcript.done"
  | "response.function_call_arguments.delta"
  | "response.function_call_arguments.done"
  | "response.done"
  | "rate_limits.updated"
  | "error";

export interface RealtimeEventHandlers {
  onSessionCreated?: (sessionId: string) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onInputTranscriptCompleted?: (text: string) => void;
  onInputTranscriptFailed?: (error: string) => void;
  onOutputTranscriptDelta?: (delta: string) => void;
  onOutputTranscriptDone?: (fullText: string) => void;
  onResponseCreated?: () => void;
  onFunctionCallDone?: (call: { callId: string; name: string; arguments: string }) => void;
  onResponseDone?: (usage: RealtimeUsage | null) => void;
  onRateLimitsUpdated?: (limits: unknown) => void;
  onError?: (error: { code?: string; message: string }) => void;
}

export interface RealtimeUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputAudioTokens: number;
  inputTextTokens: number;
  outputAudioTokens: number;
  outputTextTokens: number;
  cachedInputTokens: number;
  cachedInputAudioTokens: number;
}

/**
 * Route a raw event object to the appropriate handler. Silently ignores
 * events we don't know about — the Realtime API adds new event types with
 * each model revision and we don't want to break on first encounter.
 */
export function dispatchRealtimeEvent(
  event: unknown,
  handlers: RealtimeEventHandlers,
): void {
  if (!event || typeof event !== "object") return;
  const e = event as Record<string, unknown>;
  const type = e.type as RealtimeEventName | undefined;
  if (!type) return;

  switch (type) {
    case "session.created": {
      const sessionId = ((e.session as Record<string, unknown> | undefined)?.id as string) ?? "";
      handlers.onSessionCreated?.(sessionId);
      return;
    }

    case "session.updated":
      // No-op; we don't need to react to config changes mid-session.
      return;

    case "input_audio_buffer.speech_started":
      handlers.onSpeechStarted?.();
      return;

    case "input_audio_buffer.speech_stopped":
      handlers.onSpeechStopped?.();
      return;

    case "conversation.item.input_audio_transcription.completed": {
      const text = String(e.transcript ?? "");
      if (text) handlers.onInputTranscriptCompleted?.(text);
      return;
    }

    case "conversation.item.input_audio_transcription.failed": {
      const errObj = e.error as { message?: string } | undefined;
      handlers.onInputTranscriptFailed?.(errObj?.message ?? "transcription_failed");
      return;
    }

    case "response.created":
      handlers.onResponseCreated?.();
      return;

    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta": {
      const delta = String(e.delta ?? "");
      if (delta) handlers.onOutputTranscriptDelta?.(delta);
      return;
    }

    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done": {
      const transcript = String(e.transcript ?? "");
      if (transcript) handlers.onOutputTranscriptDone?.(transcript);
      return;
    }

    case "response.function_call_arguments.done": {
      const callId = String(e.call_id ?? "");
      const name = String(e.name ?? "");
      const args = String(e.arguments ?? "{}");
      if (callId && name) {
        handlers.onFunctionCallDone?.({ callId, name, arguments: args });
      }
      return;
    }

    case "response.done": {
      const response = e.response as Record<string, unknown> | undefined;
      const usage = extractUsage(response);
      handlers.onResponseDone?.(usage);
      return;
    }

    case "rate_limits.updated":
      handlers.onRateLimitsUpdated?.(e.rate_limits);
      return;

    case "error": {
      const errObj = e.error as { code?: string; message?: string } | undefined;
      handlers.onError?.({
        code: errObj?.code,
        message: errObj?.message ?? "unknown_error",
      });
      return;
    }

    default:
      // Unknown event — ignore.
      return;
  }
}

/**
 * Extract the usage block from a response.done event. The exact shape has
 * shifted between model revisions so we accept several variants.
 */
function extractUsage(response: Record<string, unknown> | undefined): RealtimeUsage | null {
  const usage = response?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const inputDetails = usage.input_token_details as Record<string, unknown> | undefined;
  const outputDetails = usage.output_token_details as Record<string, unknown> | undefined;
  const cachedDetails = inputDetails?.cached_tokens_details as Record<string, unknown> | undefined;

  return {
    totalTokens: num(usage.total_tokens),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    inputAudioTokens: num(inputDetails?.audio_tokens),
    inputTextTokens: num(inputDetails?.text_tokens),
    outputAudioTokens: num(outputDetails?.audio_tokens),
    outputTextTokens: num(outputDetails?.text_tokens),
    cachedInputTokens: num(inputDetails?.cached_tokens),
    cachedInputAudioTokens: num(cachedDetails?.audio_tokens),
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
