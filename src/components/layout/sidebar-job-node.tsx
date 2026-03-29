import { useMemo } from "react";
import { Bot, GripVertical, Pause } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NodeIcon } from "@/components/shared/node-icon";
import type {
  Job,
  Run,
  RunStatus,
  ScheduleConfigCalendar,
  ScheduleConfigInterval,
} from "@openhelm/shared";
import { cn, normalizeModelShortName } from "@/lib/utils";

interface SidebarJobNodeProps {
  job: Job;
  recentRuns: Run[];
  isSelected: boolean;
  isDragMode: boolean;
  onSelect: () => void;
}

function formatScheduleLabel(job: Job): string {
  switch (job.scheduleType) {
    case "once":
      return "One-time";
    case "interval": {
      const raw = job.scheduleConfig as ScheduleConfigInterval & { minutes?: number };
      // Support legacy { minutes } format from planner/chat
      const amount = raw.amount ?? (raw.minutes != null ? (raw.minutes >= 1440 ? raw.minutes / 1440 : raw.minutes >= 60 ? raw.minutes / 60 : raw.minutes) : 1);
      const unit = raw.unit ?? (raw.minutes != null ? (raw.minutes >= 1440 ? "days" : raw.minutes >= 60 ? "hours" : "minutes") : "days");
      const u = unit === "minutes" ? "min" : unit === "hours" ? "hr" : "day";
      return `Every ${amount} ${u}${amount > 1 ? "s" : ""}`;
    }
    case "cron":
      return "Cron";
    case "calendar": {
      const cfg = job.scheduleConfig as ScheduleConfigCalendar;
      const [h, m] = cfg.time.split(":").map(Number);
      const ampm = h >= 12 ? "pm" : "am";
      const h12 = h % 12 || 12;
      const time =
        m === 0
          ? `${h12}${ampm}`
          : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
      if (cfg.frequency === "daily") return `Daily · ${time}`;
      if (cfg.frequency === "weekly") {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return `${days[cfg.dayOfWeek ?? 1]} · ${time}`;
      }
      return `Monthly · ${time}`;
    }
    case "manual":
      return "Manual";
    default:
      return "";
  }
}

const dotColor: Record<RunStatus, string> = {
  deferred: "bg-blue-400",
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  permanent_failure: "bg-red-500",
  running: "bg-blue-500",
  queued: "bg-zinc-400",
  cancelled: "bg-zinc-500",
};

function RunDot({ status }: { status: RunStatus }) {
  if (status === "running") {
    return (
      <span className="relative flex size-2" title="Running">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  const label = status.replace("_", " ");
  return (
    <span
      className={cn("size-2 rounded-full", dotColor[status])}
      title={label[0].toUpperCase() + label.slice(1)}
    />
  );
}

export function SidebarJobNode({
  job,
  recentRuns,
  isSelected,
  isDragMode,
  onSelect,
}: SidebarJobNodeProps) {
  const scheduleLabel = useMemo(() => formatScheduleLabel(job), [job]);
  // Last 5, reversed so newest on right (timeline reading order)
  const dots = recentRuns.slice(0, 5).reverse();
  const isDisabled = !job.isEnabled;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id, disabled: !isDragMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-stretch", isDragging && "opacity-50")}
    >
      {isDragMode && (
        <span
          {...attributes}
          {...listeners}
          className="flex cursor-grab items-center pl-2 text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>
      )}
      <button
        onClick={onSelect}
        className={cn(
          "mb-0.5 flex min-w-0 flex-1 flex-col gap-0.5 rounded-md py-1.5 pr-2 text-left transition-colors",
          isDragMode ? "pl-1" : "pl-7",
          isSelected
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          isDisabled && !isSelected && "opacity-45",
        )}
      >
        {/* Row 1: Name + Model badge */}
        <div className="flex items-center gap-1.5">
          <NodeIcon icon={job.icon} defaultIcon="briefcase" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              isSelected && "font-medium",
            )}
          >
            {job.name}
          </span>
          {isDisabled && (
            <Pause className="size-3 shrink-0 fill-muted-foreground/50 text-muted-foreground/50" />
          )}
          {job.source === "system" && (
            <Bot className="size-3 shrink-0 text-muted-foreground/60" />
          )}
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
            {normalizeModelShortName(job.model)}
          </span>
        </div>

        {/* Row 2: Schedule + Run status dots */}
        <div className="flex items-center gap-1.5 pl-5">
          <span className="flex-1 truncate text-[11px] text-muted-foreground/70">
            {scheduleLabel}
          </span>
          {dots.length > 0 && (
            <div className="flex shrink-0 items-center gap-[3px]">
              {dots.map((run) => (
                <RunDot key={run.id} status={run.status} />
              ))}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
