import { useState, useRef, useCallback } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { useDashboardStore } from "@/stores/dashboard-store";
import { useProjectStore } from "@/stores/project-store";
import { useRunStore } from "@/stores/run-store";
import { useAppStore } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { DashboardItem } from "@openhelm/shared";

const MAX_DESC_LENGTH = 500;

export function DashboardCard({ item }: { item: DashboardItem }) {
  const { resolveItem } = useDashboardStore();
  const { projects } = useProjectStore();
  const { runs } = useRunStore();
  const { selectRunPreserveView } = useAppStore();
  const [showGuidance, setShowGuidance] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [resolving, setResolving] = useState(false);

  // Exit animation state
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [slideOut, setSlideOut] = useState(false);
  const [collapse, setCollapse] = useState(false);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  const project = projects.find((p) => p.id === item.projectId);
  const run = runs.find((r) => r.id === item.runId);
  const isFailure = item.type === "permanent_failure";

  const rawDescription = run?.summary?.trim() || item.message;
  const description =
    rawDescription.length > MAX_DESC_LENGTH
      ? rawDescription.slice(0, MAX_DESC_LENGTH) + "..."
      : rawDescription;

  // Animate card sliding right then collapsing height
  const triggerExit = useCallback(async () => {
    if (wrapperRef.current) {
      setLockedHeight(wrapperRef.current.offsetHeight);
    }
    // Wait one frame so React applies the locked height before we start sliding
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    setSlideOut(true);
    await new Promise<void>((r) => setTimeout(r, 260));
    setCollapse(true);
    await new Promise<void>((r) => setTimeout(r, 210));
  }, []);

  const handleResolve = async (action: "dismiss" | "try_again" | "do_something_different") => {
    setResolving(true);

    // For actions that create a new run, register listener BEFORE triggering resolve
    let cleanupListener: (() => void) | null = null;
    if (action === "try_again" || action === "do_something_different") {
      const handler = (e: Event) => {
        const data = (e as CustomEvent<{ runId: string; jobId: string }>).detail;
        if (data.jobId === item.jobId) {
          selectRunPreserveView(data.runId);
          cleanupListener?.();
        }
      };
      window.addEventListener("agent:run.created", handler);
      const timeoutId = setTimeout(() => {
        window.removeEventListener("agent:run.created", handler);
      }, 15_000);
      cleanupListener = () => {
        window.removeEventListener("agent:run.created", handler);
        clearTimeout(timeoutId);
      };
    }

    await triggerExit();

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

  // Click card body: stay on Dashboard, open run in right panel
  const handleCardClick = () => {
    if (!slideOut) selectRunPreserveView(item.runId);
  };

  const timeAgo = formatRelativeTime(item.createdAt);

  return (
    <div
      ref={wrapperRef}
      style={{
        height: collapse ? 0 : lockedHeight !== null ? lockedHeight : undefined,
        marginTop: collapse ? 0 : undefined,
        overflow: "hidden",
        transition: collapse ? "height 200ms ease-out, margin-top 200ms ease-out" : undefined,
      }}
    >
      <div
        style={{
          transform: slideOut ? "translateX(110%)" : "translateX(0%)",
          opacity: slideOut ? 0 : 1,
          transition: slideOut
            ? "transform 250ms ease-in, opacity 200ms ease-in"
            : undefined,
        }}
        className="rounded-lg border border-border bg-card overflow-hidden"
        onClick={handleCardClick}
      >
        {/* Clickable info area */}
        <div className="cursor-pointer p-4 hover:bg-accent/50 transition-colors">
          <div className="flex items-start gap-3">
            {isFailure ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            ) : (
              <Clock className="mt-0.5 size-5 shrink-0 text-amber-500" />
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
