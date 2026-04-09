/**
 * VoiceSettings panel — select TTS engine, voice, and interaction mode.
 * Shown via long-press on VoiceButton or from chat config area.
 */

import { useEffect } from "react";
import { Check } from "lucide-react";
import { useVoiceStore } from "@/stores/voice-store";
import type { TtsEngine, VoiceInteractionMode } from "@openhelm/shared";

const TTS_ENGINES: { value: TtsEngine; label: string; description: string }[] = [
  { value: "piper", label: "Piper", description: "Fast · Ships with app" },
  { value: "kokoro", label: "Kokoro", description: "Natural · ~330MB download" },
  { value: "coqui-xtts", label: "Coqui XTTS v2", description: "Premium · ~2GB download" },
];

const INTERACTION_MODES: { value: VoiceInteractionMode; label: string; description: string }[] = [
  { value: "conversation", label: "Conversation", description: "Mic always on, silence triggers send" },
  { value: "push-to-talk", label: "Push-to-talk", description: "Hold button to record" },
];

interface VoiceSettingsProps {
  onClose?: () => void;
}

export function VoiceSettings({ onClose }: VoiceSettingsProps) {
  const { ttsEngine, interactionMode, loadSettings, updateSettings } = useVoiceStore();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <div className="flex flex-col gap-3 p-3 text-sm" onClick={(e) => e.stopPropagation()}>
      <div>
        <p className="mb-1.5 px-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          Voice Engine
        </p>
        {TTS_ENGINES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => updateSettings({ ttsEngine: opt.value })}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {opt.value === ttsEngine && <Check className="size-3 text-primary" />}
            </span>
            <span className="font-medium">{opt.label}</span>
            <span className="ml-auto text-3xs text-muted-foreground">{opt.description}</span>
          </button>
        ))}
      </div>

      <div className="h-px bg-border" />

      <div>
        <p className="mb-1.5 px-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          Interaction Mode
        </p>
        {INTERACTION_MODES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => updateSettings({ interactionMode: opt.value })}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {opt.value === interactionMode && <Check className="size-3 text-primary" />}
            </span>
            <span className="font-medium">{opt.label}</span>
            <span className="ml-auto text-3xs text-muted-foreground">{opt.description}</span>
          </button>
        ))}
      </div>

      {onClose && (
        <>
          <div className="h-px bg-border" />
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Close
          </button>
        </>
      )}
    </div>
  );
}
