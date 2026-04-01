import { useState, useRef, useEffect } from "react";
import { Send, Settings2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useChatStore,
  CHAT_MODELS,
  CHAT_EFFORTS,
  CHAT_PERMISSION_MODES,
  type ChatModelValue,
  type ChatEffortValue,
  type ChatPermissionModeValue,
} from "@/stores/chat-store";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const configRef = useRef<HTMLDivElement>(null);
  const {
    chatModel, chatEffort, chatPermissionMode,
    setChatModel, setChatEffort, setChatPermissionMode,
  } = useChatStore();

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close config panel on outside click
  useEffect(() => {
    if (!configOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [configOpen]);

  const modelLabel = CHAT_MODELS.find((m) => m.value === chatModel)?.label ?? chatModel;
  const effortLabel = CHAT_EFFORTS.find((e) => e.value === chatEffort)?.label ?? chatEffort;
  const permLabel = CHAT_PERMISSION_MODES.find((p) => p.value === chatPermissionMode)?.label ?? chatPermissionMode;

  return (
    <div className="relative flex flex-col gap-2 border-t border-border p-3" ref={configRef}>
      {/* Config panel — opens above the settings bar */}
      {configOpen && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-0 border-t border-border bg-popover p-2 text-popover-foreground shadow-md">
          <RadioSection
            label="Model"
            options={CHAT_MODELS}
            value={chatModel}
            onChange={(v) => setChatModel(v as ChatModelValue)}
          />
          <div className="my-1.5 h-px bg-border" />
          <RadioSection
            label="Effort"
            options={CHAT_EFFORTS}
            value={chatEffort}
            onChange={(v) => setChatEffort(v as ChatEffortValue)}
          />
          <div className="my-1.5 h-px bg-border" />
          <RadioSection
            label="Tool Access"
            options={CHAT_PERMISSION_MODES}
            value={chatPermissionMode}
            onChange={(v) => setChatPermissionMode(v as ChatPermissionModeValue)}
          />
        </div>
      )}

      {/* Text input row */}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything... (Enter to send)"
          rows={1}
          disabled={disabled}
          className="max-h-32 min-h-[36px] flex-1 resize-none text-sm"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="size-9 shrink-0 p-0"
        >
          <Send className="size-4" />
        </Button>
      </div>
      {/* Compact settings bar */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setConfigOpen((o) => !o)}
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="size-3" />
          <span>{modelLabel}</span>
          <span className="opacity-40">·</span>
          <span>{effortLabel}</span>
          <span className="opacity-40">·</span>
          <span>{permLabel}</span>
        </button>
      </div>
    </div>
  );
}

/** A labelled group of radio-style option buttons. */
function RadioSection<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; description?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 px-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs transition-colors hover:bg-accent"
        >
          <span className="flex size-3.5 items-center justify-center">
            {opt.value === value && <Check className="size-3 text-primary" />}
          </span>
          <span>{opt.label}</span>
          {opt.description && (
            <span className="ml-auto text-3xs text-muted-foreground">{opt.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
