import { useState } from "react";
import { AlertTriangle, Hand } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { useProjectStore } from "@/stores/project-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@openorchestra/shared";

export function InboxCard({ item }: { item: InboxItem }) {
  const { resolveItem } = useInboxStore();
  const { projects } = useProjectStore();
  const { runs } = useRunStore();
  const { selectRun } = useAppStore();
  const [showGuidance, setShowGuidance] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [resolving, setResolving] = useState(false);

  const project = projects.find((p) => p.id === item.projectId);
  const run = runs.find((r) => r.id === item.runId);
  const isFailure = item.type === "permanent_failure";

  // Prefer the run's AI-generated summary; fall back to the inbox item message
  const description = run?.summary?.trim() || item.message;

  const handleResolve = async (action: "dismiss" | "try_again" | "do_something_different") => {
    setResolving(true);
    try {
      await resolveItem(
        item.id,
        action,
        action === "do_something_different" ? guidance : undefined,
      );
    } finally {
      setResolving(false);
    }
  };

  const handleCardClick = () => {
    selectRun(item.runId, item.jobId);
  };

  const timeAgo = formatRelativeTime(item.createdAt);

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      onClick={handleCardClick}
    >
      {/* Clickable info area */}
      <div className="cursor-pointer p-4 hover:bg-accent/50 transition-colors">
        <div className="flex items-start gap-3">
          {isFailure ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          ) : (
            <Hand className="mt-0.5 size-5 shrink-0 text-amber-500" />
          )}
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-medium break-words">{item.title}</span>
            <p className="mt-1 text-sm text-muted-foreground break-words whitespace-pre-wrap">
              {description}
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {project && (
                <Badge variant="outline" className="text-[10px]">
                  {project.name}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">{timeAgo}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action area — stopPropagation so clicks don't open run detail */}
      <div
        className="border-t border-border px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {showGuidance ? (
          <div className="space-y-2">
            <Textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Describe what should be done differently..."
              rows={3}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!guidance.trim() || resolving}
                onClick={() => handleResolve("do_something_different")}
              >
                Submit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowGuidance(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              disabled={resolving}
              onClick={() => handleResolve("try_again")}
            >
              Try Again
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={resolving}
              onClick={() => setShowGuidance(true)}
            >
              Do Something Different
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={resolving}
              onClick={() => handleResolve("dismiss")}
            >
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
