/**
 * VoiceProjectSetupStep — onboarding step 6.
 * A full-screen conversational interface where the user describes their
 * project by voice and the AI creates goals and jobs.
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, ArrowRight, Type } from "lucide-react";
import { VoiceButton } from "@/components/voice/voice-button";
import { useVoiceStore } from "@/stores/voice-store";
import { useChatStore } from "@/stores/chat-store";
import * as api from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface VoiceProjectSetupStepProps {
  projectId: string | null;
  onNext: () => void;
  onSkip: () => void;
}

const GREETING =
  "I'd love to learn about your project. What are you building, and what would you like me to help you with?";

export function VoiceProjectSetupStep({ projectId, onNext, onSkip }: VoiceProjectSetupStepProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: GREETING },
  ]);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [goalsCreated, setGoalsCreated] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { liveTranscript, status: voiceStatus, cancelSession } = useVoiceStore();

  // Create a dedicated conversation for onboarding
  useEffect(() => {
    if (!projectId) return;
    api.createConversation({ projectId, title: "Onboarding Setup" })
      .then((conv) => setConversationId(conv.id))
      .catch(() => { /* fallback: use default conversation */ });
  }, [projectId]);

  // Listen for chat messages from the agent (new assistant messages in this conversation)
  useEffect(() => {
    const handler = (e: Event) => {
      const { conversationId: convId, role, content, pendingActions } = (e as CustomEvent).detail;
      if (convId !== conversationId) return;
      if (role === "assistant" && content) {
        setMessages((prev) => [...prev, { role: "assistant", text: content }]);
        if (pendingActions?.length) setGoalsCreated(true);
      }
    };
    window.addEventListener("agent:chat.messageCreated", handler);
    return () => window.removeEventListener("agent:chat.messageCreated", handler);
  }, [conversationId]);

  // When voice transcript arrives and LLM starts thinking, record it
  useEffect(() => {
    if (liveTranscript && voiceStatus === "thinking") {
      setMessages((prev) => [...prev, { role: "user", text: liveTranscript }]);
    }
  }, [liveTranscript, voiceStatus]);

  // Auto-scroll to bottom
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendTextMessage = async () => {
    const trimmed = textInput.trim();
    if (!trimmed || sending || !projectId) return;
    setTextInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    try {
      await api.sendChatMessage({
        projectId,
        conversationId: conversationId ?? undefined,
        content: trimmed,
        context: { onboardingMode: true } as any,
      });
    } finally {
      setSending(false);
    }
  };

  const handleSkip = () => {
    cancelSession();
    onSkip();
  };

  return (
    <div className="flex flex-col" style={{ minHeight: "420px" }}>
      <h2 className="text-2xl font-semibold">Tell me about your project</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Speak naturally — I'll set up goals and jobs based on what you describe.
      </p>

      {/* Message list */}
      <div
        ref={listRef}
        className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3"
        style={{ maxHeight: "260px", minHeight: "180px" }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-background px-3 py-2 text-sm text-muted-foreground">
              <span className="animate-pulse">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="mt-3 flex items-end gap-2">
        {!textMode ? (
          <>
            <VoiceButton
              projectId={projectId}
              conversationId={conversationId}
              mode="conversation"
              size="md"
              className="mx-auto"
            />
            <button
              type="button"
              onClick={() => setTextMode(true)}
              className="absolute right-0 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Type instead
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendTextMessage(); }}
              placeholder="Type your message..."
              disabled={sending}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              autoFocus
            />
            <Button size="sm" onClick={sendTextMessage} disabled={!textInput.trim() || sending}>
              Send
            </Button>
            <button
              type="button"
              onClick={() => setTextMode(false)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              <Mic className="size-4" />
            </button>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={handleSkip}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Skip this step
        </button>
        {goalsCreated && (
          <Button onClick={() => { cancelSession(); onNext(); }} size="sm">
            Continue
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
