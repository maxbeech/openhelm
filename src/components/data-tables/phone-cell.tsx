import { useState, useRef, useEffect } from "react";
import { Phone } from "lucide-react";

interface Props {
  value: unknown;
  onChange: (v: unknown) => void;
}

export function PhoneCell({ value, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const displayValue = value !== null && value !== undefined ? String(value) : "";

  const startEdit = () => {
    setDraft(displayValue);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = draft.trim() || null;
    if (parsed !== value) onChange(parsed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") setEditing(false);
        }}
        type="tel"
        className="w-full bg-transparent px-3 py-1.5 text-sm outline-none ring-1 ring-primary/50"
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      className="min-h-[30px] cursor-text px-3 py-1.5 text-sm truncate group/phone"
    >
      {displayValue ? (
        <span className="inline-flex items-center gap-1.5">
          <Phone className="size-3 text-muted-foreground shrink-0" />
          <a
            href={`tel:${displayValue}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline truncate"
          >
            {displayValue}
          </a>
        </span>
      ) : (
        <span className="text-muted-foreground/30">-</span>
      )}
    </div>
  );
}
