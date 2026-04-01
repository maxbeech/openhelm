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
  ScheduleConfigCron,
  ScheduleConfigInterval,
} from "@openhelm/shared";
import { cn, normalizeModelShortName } from "@/lib/utils";
import { describeCron } from "@/lib/format";

interface SidebarJobNodeProps {
  job: Job;
  recentRuns: Run[];
  isSelected: boolean;
  isDragMode: boolean;
  onSelect: () => void;
  /** Indent level for nested goals (0 = direct child of root goal) */
  indentLevel?: number;
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
    case "cron": {
      const cfg = job.scheduleConfig as ScheduleConfigCron;
      return describeCron(cfg.expression);
    }
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
        // daysOfWeek (multi-day) takes precedence over legacy single-day dayOfWeek
        const label = cfg.daysOfWeek && cfg.daysOfWeek.length > 0
          ? cfg.daysOfWeek.map((d) => days[d]).join(", ")
          : days[cfg.dayOfWeek ?? 1];
        return `${label} · ${time}`;
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
  // "deferred" = run is waiting for a scheduled future time (scheduler promotes
  // it to "queued" when its scheduledFor time arrives). Shown in blue to
  // distinguish it from an actively queued run.
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
  indentLevel = 0,
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
    isDragging,
  } = useSortable({ id: job.id, disabled: !isDragMode });

  // No transition — prevents the FLIP snap-back animation on drag release
  const style = { transform: CSS.Transform.toString(transform) };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, paddingLeft: indentLevel > 0 ? `${indentLevel * 16}px` : undefined }}
      className={cn("group flex items-stretch", isDragging && "opacity-50")}
    >
      {/* Grip always rendered to prevent layout shift; invisible when drag inactive.
          The grip+padding total (pl-2=8px + icon 14px = 22px) plus the button's
          pl-3.5 (14px) = 36px — matches the original non-drag pl-9 indent. */}
      <span
        {...(isDragMode ? { ...attributes, ...listeners } : {})}
        className={cn(
          "flex items-center pl-2",
          isDragMode
            ? "cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
            : "invisible pointer-events-none cursor-default",
        )}
      >
        <GripVertical className="size-3.5" />
      </span>
      <button
        onClick={onSelect}
        className={cn(
          "mb-0.5 flex min-w-0 flex-1 flex-col gap-0.5 rounded-md py-1.5 pl-3.5 pr-2 text-left transition-colors",
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
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-3xs leading-none text-muted-foreground">
            {normalizeModelShortName(job.model)}
          </span>
        </div>

        {/* Row 2: Schedule + Run status dots */}
        <div className="flex items-center gap-1.5 pl-5">
          <span className="flex-1 truncate text-2xs text-muted-foreground/70">
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
