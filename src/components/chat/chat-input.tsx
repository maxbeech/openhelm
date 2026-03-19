import { useState, useRef } from "react";
import { Send, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const modelLabel = CHAT_MODELS.find((m) => m.value === chatModel)?.label ?? chatModel;
  const effortLabel = CHAT_EFFORTS.find((e) => e.value === chatEffort)?.label ?? chatEffort;
  const permLabel = CHAT_PERMISSION_MODES.find((p) => p.value === chatPermissionMode)?.label ?? chatPermissionMode;

  return (
    <div className="flex flex-col gap-2 border-t border-border p-3">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Settings2 className="size-3" />
              <span>{modelLabel}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{effortLabel}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{permLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-xs">Model</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chatModel} onValueChange={(v) => setChatModel(v as ChatModelValue)}>
              {CHAT_MODELS.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value} className="text-xs">
                  {m.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Effort</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chatEffort} onValueChange={(v) => setChatEffort(v as ChatEffortValue)}>
              {CHAT_EFFORTS.map((e) => (
                <DropdownMenuRadioItem key={e.value} value={e.value} className="text-xs">
                  {e.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Tool Access</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chatPermissionMode} onValueChange={(v) => setChatPermissionMode(v as ChatPermissionModeValue)}>
              {CHAT_PERMISSION_MODES.map((p) => (
                <DropdownMenuRadioItem key={p.value} value={p.value} className="text-xs">
                  <span>{p.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{p.description}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
