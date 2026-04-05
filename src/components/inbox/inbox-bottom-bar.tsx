import { X, Reply, ZoomIn, ZoomOut } from "lucide-react";
import { useInboxStore } from "@/stores/inbox-store";
import { InboxInput } from "./inbox-input";
import { InboxTierSlider } from "./inbox-tier-slider";

interface Props {
  projectId: string | null;
  onZoomLabelChange?: (label: string) => void;
}

export function InboxBottomBar({ projectId, onZoomLabelChange }: Props) {
  const { replyContext, setReplyContext, tierBoundaries } = useInboxStore();
  const hasMultipleTiers = tierBoundaries.length > 0;

  return (
    <div className="shrink-0 border-t border-border bg-background">
      {/* Reply context banner */}
      {replyContext && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5">
          <Reply className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Replying to: {replyContext.preview}
          </span>
          <button
            onClick={() => setReplyContext(null)}
            className="shrink-0 rounded p-0.5 hover:bg-accent"
          >
            <X className="size-3 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Chat input */}
      <div className="px-4 py-3">
        <InboxInput projectId={projectId} />
      </div>

      {/* Tier slider — only show when there are multiple tiers */}
      {hasMultipleTiers && (
        <div className="flex items-center gap-3 border-t border-border/50 px-4 py-2">
          <ZoomOut className="size-3.5 shrink-0 text-muted-foreground" />
          <InboxTierSlider onZoomLabelChange={onZoomLabelChange} />
          <ZoomIn className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
