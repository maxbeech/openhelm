/**
 * VoiceButton — reusable mic button used in chat input, inbox input, and onboarding.
 *
 * States:
 *   idle           → mic icon (click to start)
 *   listening      → pulsing red ring + waveform (click to stop in conv mode; hold in ptt)
 *   transcribing   → spinner
 *   thinking       → subtle pulse (LLM generating)
 *   speaking       → sound wave animation (TTS playing)
 *   awaiting-approval → pause icon + inline approval buttons
 */

import { useState, useRef, useCallback } from "react";
import { Mic, Square, Loader2, Volume2, Pause, Settings2 } from "lucide-react";
import { useVoiceStore } from "@/stores/voice-store";
import { VoiceWaveform } from "./voice-waveform";
import { VoiceSettings } from "./voice-settings";

export interface VoiceButtonProps {
  projectId: string | null;
  conversationId?: string | null;
  /** default: "conversation" */
  mode?: "conversation" | "push-to-talk";
  /** sm = inline next to send button; md = onboarding large button */
  size?: "sm" | "md";
  className?: string;
  /** Called when the voice session emits a transcript (useful for onboarding) */
  onTranscript?: (text: string) => void;
}

export function VoiceButton({
  projectId,
  conversationId,
  mode = "conversation",
  size = "sm",
  className = "",
  onTranscript,
}: VoiceButtonProps) {
  const {
    sessionId,
    status,
    interactionMode,
    inputLevel,
    liveTranscript,
    pendingApproval,
    demoSecondsRemaining,
    startSession,
    stopRecording,
    cancelSession,
    approveAction,
    interruptPlayback,
  } = useVoiceStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = sessionId !== null;

  const handleClick = useCallback(async () => {
    if (settingsOpen) { setSettingsOpen(false); return; }
    if (!isActive) {
      try {
        await startSession(projectId, conversationId ?? undefined);
      } catch (err) {
        console.error("[voice] could not start:", err);
      }
      return;
    }
    // Active session actions depend on current status
    if (status === "listening") {
      if (interactionMode === "push-to-talk") {
        await stopRecording();
      } else {
        // Conversation mode: click to cancel
        cancelSession();
      }
    } else if (status === "speaking") {
      interruptPlayback();
    } else if (status === "transcribing" || status === "thinking") {
      cancelSession();
    }
  }, [isActive, status, interactionMode, projectId, conversationId,
    startSession, stopRecording, cancelSession, interruptPlayback, settingsOpen]);

  // Long press to open settings
  const handlePointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => setSettingsOpen(true), 700);
  }, []);
  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const iconSize = size === "md" ? "size-6" : "size-4";
  const btnBase = size === "md"
    ? "flex h-14 w-14 items-center justify-center rounded-full transition-all"
    : "flex size-9 shrink-0 items-center justify-center rounded-lg transition-all";

  let btnCls = btnBase;
  let icon: React.ReactNode;
  let title: string;

  if (!isActive || status === "idle") {
    btnCls += " border border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/40";
    icon = <Mic className={iconSize} />;
    title = "Start voice";
  } else if (status === "listening") {
    btnCls += " relative bg-destructive/10 text-destructive ring-2 ring-destructive/40 ring-offset-1";
    icon = <VoiceWaveform level={inputLevel} className="text-destructive" />;
    title = "Click to stop";
  } else if (status === "transcribing") {
    btnCls += " bg-secondary text-muted-foreground";
    icon = <Loader2 className={`${iconSize} animate-spin`} />;
    title = "Transcribing...";
  } else if (status === "thinking") {
    btnCls += " bg-secondary text-primary";
    icon = <Loader2 className={`${iconSize} animate-spin opacity-60`} />;
    title = "Thinking...";
  } else if (status === "speaking") {
    btnCls += " bg-secondary text-primary";
    icon = <Volume2 className={iconSize} />;
    title = "Click to interrupt";
  } else if (status === "awaiting-approval") {
    btnCls += " bg-warning/10 text-warning";
    icon = <Pause className={iconSize} />;
    title = "Awaiting approval";
  } else {
    btnCls += " bg-secondary text-muted-foreground";
    icon = <Mic className={iconSize} />;
    title = "Voice";
  }

  return (
    <div className={`group relative ${className}`}>
      {/* Settings dropdown */}
      {settingsOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-64 rounded-lg border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium">Voice Settings</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <VoiceSettings onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      <button
        type="button"
        title={title}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={btnCls}
      >
        {icon}
      </button>

      {/* Demo voice budget badge — shown when demo session is active */}
      {isActive && demoSecondsRemaining !== null && demoSecondsRemaining > 0 && (
        <span className="pointer-events-none absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground">
          {demoSecondsRemaining}s
        </span>
      )}

      {/* Pending approval inline buttons */}
      {status === "awaiting-approval" && pendingApproval && (
        <div className="absolute bottom-full right-0 z-40 mb-1 flex items-center gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <span className="max-w-48 truncate text-xs text-muted-foreground">
            {pendingApproval.spokenSummary}
          </span>
          <button
            type="button"
            onClick={() => approveAction("approve")}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-success hover:bg-success/10"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => approveAction("reject")}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            Reject
          </button>
        </div>
      )}

      {/* Settings gear icon (always visible on hover for size=sm) */}
      {size === "sm" && !isActive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSettingsOpen((o) => !o); }}
          className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-60"
          title="Voice settings"
        >
          <Settings2 className="size-2.5" />
        </button>
      )}
    </div>
  );
}
