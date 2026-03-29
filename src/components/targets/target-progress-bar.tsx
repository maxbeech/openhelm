import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TargetEvaluation } from "@openhelm/shared";

interface TargetProgressBarProps {
  evaluation: TargetEvaluation;
  compact?: boolean;
}

const DIRECTION_LABELS: Record<string, string> = {
  gte: "\u2265",
  lte: "\u2264",
  eq: "=",
};

export function TargetProgressBar({ evaluation, compact }: TargetProgressBarProps) {
  const pct = Math.round(evaluation.progress * 100);
  const dir = DIRECTION_LABELS[evaluation.direction] ?? "";
  const current = evaluation.currentValue != null ? evaluation.currentValue : "—";

  const barColor = evaluation.met
    ? "[&_[data-slot=progress-indicator]]:bg-green-500"
    : pct > 50
      ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
      : "[&_[data-slot=progress-indicator]]:bg-red-500";

  if (compact) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Progress value={pct} className={cn("h-1.5 flex-1", barColor)} />
        <span className="text-xs text-muted-foreground shrink-0">{pct}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {current} / {dir}{evaluation.targetValue}
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            evaluation.met
              ? "text-green-500"
              : evaluation.isOverdue
                ? "text-red-500"
                : "text-muted-foreground",
          )}
        >
          {evaluation.met ? "Met" : evaluation.isOverdue ? "Overdue" : `${pct}%`}
        </span>
      </div>
      <Progress value={pct} className={cn("h-2", barColor)} />
    </div>
  );
}
