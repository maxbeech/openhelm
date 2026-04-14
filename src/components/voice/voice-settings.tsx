/**
 * VoiceSettings panel — mode-aware.
 *
 * Local (Tauri): TTS engine (Piper/Kokoro/Coqui) + interaction mode selectors.
 * Cloud (browser): Realtime model (mini/flagship) + voice (marin/cedar/...)
 *                  selectors. Interaction mode is fixed to "conversation" —
 *                  semantic VAD handles turn detection server-side.
 */

import { useEffect } from "react";
import { Check } from "lucide-react";
import { useVoiceStore, type CloudVoiceModel } from "@/stores/voice-store";
import { isCloudMode } from "@/lib/mode";
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

const CLOUD_MODELS: { value: CloudVoiceModel; label: string; description: string }[] = [
  { value: "gpt-realtime-mini", label: "Mini", description: "Fast · Lower cost" },
  { value: "gpt-realtime", label: "Flagship", description: "Richer · Higher cost" },
];

const CLOUD_VOICES: { value: string; label: string; description: string }[] = [
  { value: "marin", label: "Marin", description: "Calm · Composed · Default" },
  { value: "cedar", label: "Cedar", description: "Warm · Grounded" },
  { value: "ash", label: "Ash", description: "Neutral · Approachable" },
  { value: "verse", label: "Verse", description: "Light · Animated" },
  { value: "coral", label: "Coral", description: "Bright · Friendly" },
  { value: "shimmer", label: "Shimmer", description: "Soft · Gentle" },
  { value: "ballad", label: "Ballad", description: "Deep · Deliberate" },
  { value: "sage", label: "Sage", description: "Thoughtful · Even" },
  { value: "alloy", label: "Alloy", description: "Clear · Classic" },
  { value: "echo", label: "Echo", description: "Crisp · Direct" },
];

interface VoiceSettingsProps {
  onClose?: () => void;
}

export function VoiceSettings({ onClose }: VoiceSettingsProps) {
  const {
    ttsEngine,
    interactionMode,
    selectedVoice,
    cloudVoiceModel,
    loadSettings,
    updateSettings,
  } = useVoiceStore();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  if (isCloudMode) {
    return (
      <div className="flex flex-col gap-3 p-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="mb-1.5 px-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            Model
          </p>
          {CLOUD_MODELS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateSettings({ cloudVoiceModel: opt.value })}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {opt.value === cloudVoiceModel && <Check className="size-3 text-primary" />}
              </span>
              <span className="font-medium">{opt.label}</span>
              <span className="ml-auto text-3xs text-muted-foreground">{opt.description}</span>
            </button>
          ))}
        </div>

        <div className="h-px bg-border" />

        <div>
          <p className="mb-1.5 px-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            Voice
          </p>
          <div className="max-h-56 overflow-y-auto">
            {CLOUD_VOICES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSettings({ voiceId: opt.value })}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent"
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {opt.value === selectedVoice && <Check className="size-3 text-primary" />}
                </span>
                <span className="font-medium">{opt.label}</span>
                <span className="ml-auto text-3xs text-muted-foreground">{opt.description}</span>
              </button>
            ))}
          </div>
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

  // Local (Tauri) mode — original TTS engine + interaction mode selectors.
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
