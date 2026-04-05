import type { InboxEvent } from "@openhelm/shared";

interface Props {
  event: InboxEvent;
  timestamp: string;
}

export function EventUserMessage({ event, timestamp }: Props) {
  const content = event.body || event.title;

  return (
    <div className="my-1 flex justify-end">
      <div className="max-w-[85%]">
        <div className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">
          <div className="mb-1 flex items-center justify-end gap-1.5">
            <span className="text-3xs text-primary-foreground/60">{timestamp}</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}
