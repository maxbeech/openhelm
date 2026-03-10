import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, X, Wrench } from "lucide-react";
import type { PendingAction } from "@openorchestra/shared";

interface ActionCardProps {
  action: PendingAction;
}

function formatArgs(args: Record<string, unknown>): string {
  const lines = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return lines.join("\n");
}

export function ActionCard({ action }: ActionCardProps) {
  const isPending = action.status === "pending";
  const isApproved = action.status === "approved";
  const isRejected = action.status === "rejected";

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        isApproved
          ? "border-green-500/30 bg-green-500/10"
          : isRejected
            ? "border-border bg-muted/50 opacity-60"
            : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {isApproved ? (
          <Check className="size-3.5 shrink-0 text-green-600" />
        ) : isRejected ? (
          <X className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Wrench className="size-3.5 shrink-0 text-primary" />
        )}
        <span className="markdown-content truncate [&_p]:m-0 [&_p]:inline">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{action.description}</ReactMarkdown>
        </span>
        {isApproved && (
          <span className="ml-auto shrink-0 text-xs text-green-600">Done</span>
        )}
        {isRejected && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">Rejected</span>
        )}
        {isPending && (
          <span className="ml-auto shrink-0 text-xs text-primary">Pending</span>
        )}
      </div>

      {Object.keys(action.args).length > 0 && (
        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded bg-background/50 p-2 text-xs text-muted-foreground">
          {formatArgs(action.args)}
        </pre>
      )}
    </div>
  );
}
