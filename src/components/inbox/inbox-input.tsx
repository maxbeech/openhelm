import { useState, useCallback, useRef, useMemo, useEffect, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { pickNauticalPlaceholder } from "@/lib/nautical-placeholders";
import { VoiceButton } from "@/components/voice/voice-button";
import { useVoiceStore } from "@/stores/voice-store";

interface Props {
  projectId: string | null;
}

export function InboxInput({ projectId }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, sending } = useInboxStore();
  const placeholder = useMemo(() => pickNauticalPlaceholder(), []);
  const { liveTranscript, status: voiceStatus, conversationId: voiceConvId } = useVoiceStore();

  // Auto-send voice transcript to inbox only when voice was started from the inbox
  // (conversationId === null means the session has no associated chat conversation).
  // This prevents inbox from intercepting voice sessions started from the chat panel.
  useEffect(() => {
    if (liveTranscript && voiceStatus === "thinking" && voiceConvId === null) {
      sendMessage(projectId, liveTranscript);
    }
  }, [liveTranscript, voiceStatus, voiceConvId, sendMessage, projectId]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    sendMessage(projectId, trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, sending, sendMessage, projectId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, []);

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => { setText(e.target.value); handleInput(); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="max-h-32 min-h-[36px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
        disabled={sending}
      />
      <VoiceButton projectId={projectId} size="sm" />
      <button
        onClick={handleSend}
        disabled={!text.trim() || sending}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}
