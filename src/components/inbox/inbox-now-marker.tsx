import { useMemo } from "react";

export function InboxNowMarker() {
  const timeString = useMemo(() => {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  return (
    <div className="relative my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-primary/40" />
      <span className="shrink-0 rounded-full bg-primary/10 px-3 py-0.5 text-2xs font-medium text-primary">
        Now &middot; {timeString}
      </span>
      <div className="h-px flex-1 bg-primary/40" />
    </div>
  );
}
