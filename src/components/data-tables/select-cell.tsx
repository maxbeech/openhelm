import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import type { DataTableColumn, SelectOption } from "@openhelm/shared";
import { cn } from "@/lib/utils";

// ─── Option color palette (Notion-style soft pastel backgrounds) ───

const OPTION_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300" },
  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-yellow-100 dark:bg-yellow-900/40", text: "text-yellow-700 dark:text-yellow-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300" },
];

function colorClassForOption(opt: SelectOption, allOptions: SelectOption[]) {
  if (opt.color) return opt.color;
  const idx = allOptions.indexOf(opt);
  return `${OPTION_COLORS[idx % OPTION_COLORS.length].bg} ${OPTION_COLORS[idx % OPTION_COLORS.length].text}`;
}

// ─── Shared pill ───

function OptionPill({
  option,
  options,
  onRemove,
}: {
  option: SelectOption;
  options: SelectOption[];
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium max-w-[150px] truncate",
        colorClassForOption(option, options),
      )}
    >
      <span className="truncate">{option.label}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Portal dropdown (fixed-positioned to escape overflow containers) ───

interface DropdownProps {
  anchorRect: DOMRect;
  options: SelectOption[];
  selectedIds: string[];
  multi: boolean;
  onSelect: (id: string) => void;
  onDeselect: (id: string) => void;
  onCreate: (label: string) => void;
  onClose: () => void;
}

function SelectDropdown({
  anchorRect,
  options,
  selectedIds,
  multi,
  onSelect,
  onDeselect,
  onCreate,
  onClose,
}: DropdownProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus without scrolling — critical to prevent layout jump
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const canCreate =
    search.trim() !== "" &&
    !options.some((o) => o.label.toLowerCase() === search.trim().toLowerCase());

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onDeselect(id);
    } else {
      onSelect(id);
    }
    if (!multi) onClose();
    setSearch("");
  };

  // Position: below anchor (flip up if near bottom); clamp so panel never exits viewport.
  const PANEL_WIDTH = 224;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow > 220 ? anchorRect.bottom + 2 : anchorRect.top - 220 - 2;
  // Clamp left so right edge of panel stays within viewport with MARGIN clearance
  const left = Math.min(anchorRect.left, Math.max(MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN));

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top,
        left,
        width: PANEL_WIDTH,
        zIndex: 9999,
      }}
      className="rounded-md border border-border bg-popover shadow-lg"
    >
      <div className="border-b border-border px-2 py-1.5">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && canCreate) { onCreate(search.trim()); setSearch(""); }
          }}
          placeholder="Search or create..."
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {filtered.length === 0 && !canCreate && (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">No options found</p>
        )}
        {filtered.map((opt) => {
          const selected = selectedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              onMouseDown={(e) => { e.preventDefault(); handleToggle(opt.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
            >
              <span className={cn("rounded-full px-2 py-0.5 font-medium flex-1 text-left truncate", colorClassForOption(opt, options))}>
                {opt.label}
              </span>
              {selected && <Check className="size-3 shrink-0 text-primary" />}
            </button>
          );
        })}
        {canCreate && (
          <button
            onMouseDown={(e) => { e.preventDefault(); onCreate(search.trim()); setSearch(""); }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
          >
            <span className="text-muted-foreground">Create</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground truncate max-w-[120px]">
              {search.trim()}
            </span>
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// ─── Select cell ───

interface SelectCellProps {
  column: DataTableColumn;
  value: unknown;
  onChange: (v: unknown) => void;
  onColumnConfigUpdate: (config: Record<string, unknown>) => void;
}

export function SelectCell({ column, value, onChange, onColumnConfigUpdate }: SelectCellProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const options = (column.config?.options ?? []) as SelectOption[];
  const selectedId = value as string | null | undefined;
  const selected = options.find((o) => o.id === selectedId);

  const handleOpen = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const handleCreate = (label: string) => {
    const colorIdx = options.length % OPTION_COLORS.length;
    const newOpt: SelectOption = {
      id: `opt_${crypto.randomUUID().slice(0, 8)}`,
      label,
      color: `${OPTION_COLORS[colorIdx].bg} ${OPTION_COLORS[colorIdx].text}`,
    };
    onColumnConfigUpdate({ ...column.config, options: [...options, newOpt] });
    onChange(newOpt.id);
    setOpen(false);
  };

  return (
    <div className="relative w-full min-h-[30px]">
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className="flex min-h-[30px] cursor-pointer items-center px-2 py-1 hover:bg-accent/30 transition-colors"
      >
        {selected ? (
          <OptionPill option={selected} options={options} />
        ) : (
          <span className="text-muted-foreground/30 text-sm">-</span>
        )}
      </div>
      {open && anchorRect && (
        <SelectDropdown
          anchorRect={anchorRect}
          options={options}
          selectedIds={selectedId ? [selectedId] : []}
          multi={false}
          onSelect={(id) => onChange(id)}
          onDeselect={() => onChange(null)}
          onCreate={handleCreate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Multi-select cell ───

interface MultiSelectCellProps {
  column: DataTableColumn;
  value: unknown;
  onChange: (v: unknown) => void;
  onColumnConfigUpdate: (config: Record<string, unknown>) => void;
}

export function MultiSelectCell({ column, value, onChange, onColumnConfigUpdate }: MultiSelectCellProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const options = (column.config?.options ?? []) as SelectOption[];
  const selectedIds = (Array.isArray(value) ? value : []) as string[];
  const selectedOptions = selectedIds.map((id) => options.find((o) => o.id === id)).filter(Boolean) as SelectOption[];

  const handleOpen = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const handleCreate = (label: string) => {
    const colorIdx = options.length % OPTION_COLORS.length;
    const newOpt: SelectOption = {
      id: `opt_${crypto.randomUUID().slice(0, 8)}`,
      label,
      color: `${OPTION_COLORS[colorIdx].bg} ${OPTION_COLORS[colorIdx].text}`,
    };
    onColumnConfigUpdate({ ...column.config, options: [...options, newOpt] });
    onChange([...selectedIds, newOpt.id]);
  };

  return (
    <div className="relative w-full min-h-[30px]">
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className="flex min-h-[30px] cursor-pointer flex-wrap items-center gap-1 px-2 py-1 hover:bg-accent/30 transition-colors"
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <OptionPill
              key={opt.id}
              option={opt}
              options={options}
              onRemove={() => onChange(selectedIds.filter((s) => s !== opt.id))}
            />
          ))
        ) : (
          <span className="text-muted-foreground/30 text-sm">-</span>
        )}
      </div>
      {open && anchorRect && (
        <SelectDropdown
          anchorRect={anchorRect}
          options={options}
          selectedIds={selectedIds}
          multi={true}
          onSelect={(id) => onChange([...selectedIds, id])}
          onDeselect={(id) => onChange(selectedIds.filter((s) => s !== id))}
          onCreate={handleCreate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
