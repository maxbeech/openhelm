interface Props {
  value: string | null | undefined;
}

export function TimestampCell({ value }: Props) {
  if (!value) {
    return (
      <div className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground/30">
        -
      </div>
    );
  }

  const date = new Date(value);
  const display = formatTimestamp(date);

  return (
    <div
      className="min-h-[30px] px-3 py-1.5 text-sm text-muted-foreground truncate"
      title={date.toISOString()}
    >
      {display}
    </div>
  );
}

function formatTimestamp(date: Date): string {
  if (isNaN(date.getTime())) return "Invalid date";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // If today, show time
  if (diffDays === 0 && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // If within last 7 days, show relative
  if (diffDays > 0 && diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
