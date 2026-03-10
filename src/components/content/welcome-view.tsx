import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat-store";

interface WelcomeViewProps {
  projectId: string;
}

export function WelcomeView({ projectId }: WelcomeViewProps) {
  const [value, setValue] = useState("");
  const { openPanel, sendMessage } = useChatStore();

  const handleSubmit = () => {
    if (!value.trim()) return;
    openPanel();
    sendMessage(projectId, value.trim()).catch(() => {});
    setValue("");
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2 text-primary">
          <Sparkles className="size-5" />
          <span className="text-sm font-medium uppercase tracking-widest">
            OpenOrchestra
          </span>
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold">
          What would you like Claude to work on?
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Describe a goal or task — the AI assistant will help you plan and set
          it up.
        </p>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="e.g. Improve test coverage to 80%, fix TypeScript strict mode errors, add OpenAPI documentation..."
          className="mb-3 min-h-28 resize-none text-sm"
          autoFocus
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for new line
          </p>
          <Button onClick={handleSubmit} disabled={!value.trim()}>
            <ArrowRight className="mr-1.5 size-4" />
            Get started
          </Button>
        </div>
      </div>
    </div>
  );
}
