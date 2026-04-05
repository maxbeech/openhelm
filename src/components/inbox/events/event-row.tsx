import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EventRowBadge {
  label: string;
  className: string;
}

interface EventRowProps {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  description?: string | null;
  badge?: EventRowBadge;
  timestamp: string;
  isUnread?: boolean;
}

/**
 * Unified event row — used by all non-message inbox events.
 * Consistent layout: icon | title (+ optional description) | badge | timestamp.
 */
export function EventRow({
  icon: Icon,
  iconColor,
  title,
  description,
  badge,
  timestamp,
  isUnread,
}: EventRowProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/30">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", iconColor ?? "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", isUnread && "font-medium")}>{title}</span>
          {badge && (
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-3xs font-medium", badge.className)}>
              {badge.label}
            </span>
          )}
          <span className="shrink-0 text-3xs text-muted-foreground">{timestamp}</span>
        </div>
        {description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
