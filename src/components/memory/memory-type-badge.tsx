import type { MemoryType } from "@openhelm/shared";
import { cn } from "@/lib/utils";

const TYPE_STYLES: Record<MemoryType, string> = {
  semantic: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  episodic: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  procedural: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  source: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const TYPE_LABELS: Record<MemoryType, string> = {
  semantic: "Fact",
  episodic: "Experience",
  procedural: "Workflow",
  source: "Source",
};

interface MemoryTypeBadgeProps {
  type: MemoryType;
  className?: string;
}

export function MemoryTypeBadge({ type, className }: MemoryTypeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-semibold",
        TYPE_STYLES[type],
        className,
      )}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}
