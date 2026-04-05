import { useMemo } from "react";

interface Props {
  date: string; // YYYY-MM-DD
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";

  // Future dates: show "Tomorrow", day name, or full date
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return "Tomorrow";

  const diff = date.getTime() - now.getTime();
  if (diff > 0 && diff < 7 * 86400000) {
    return date.toLocaleDateString([], { weekday: "long" });
  }

  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function InboxTimeHeader({ date }: Props) {
  const label = useMemo(() => formatDateLabel(date), [date]);

  return (
    <div className="sticky top-0 z-10 -mx-4 bg-background/90 px-4 py-1.5 backdrop-blur-sm">
      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
