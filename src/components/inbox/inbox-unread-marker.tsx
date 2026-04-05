export function InboxUnreadMarker() {
  return (
    <div className="relative my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-amber-500/40" />
      <span className="shrink-0 rounded-full bg-amber-500/10 px-3 py-0.5 text-2xs font-medium text-amber-500">
        New
      </span>
      <div className="h-px flex-1 bg-amber-500/40" />
    </div>
  );
}
