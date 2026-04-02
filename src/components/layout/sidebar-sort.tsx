import { useState, useRef, useCallback } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortMode, Goal, Job } from "@openhelm/shared";

// ─── Sort category definitions ─────────────────────────────────────────────

type SortCategory = "custom" | "alpha" | "created" | "updated" | "tokens";

interface CategoryDef {
  label: string;
  asc: SortMode;
  desc: SortMode;
  defaultDir: "asc" | "desc";
}

const CATEGORIES: { key: SortCategory; def: CategoryDef }[] = [
  { key: "alpha",   def: { label: "A – Z",        asc: "alpha_asc",    desc: "alpha_desc",   defaultDir: "asc"  } },
  { key: "created", def: { label: "Created at",   asc: "created_asc",  desc: "created_desc", defaultDir: "asc"  } },
  { key: "updated", def: { label: "Updated at",   asc: "updated_asc",  desc: "updated_desc", defaultDir: "asc"  } },
  { key: "tokens",  def: { label: "Token usage",  asc: "tokens_asc",   desc: "tokens_desc",  defaultDir: "desc" } },
];

function modeToCategory(mode: SortMode): SortCategory {
  if (mode === "custom")           return "custom";
  if (mode.startsWith("alpha"))    return "alpha";
  if (mode.startsWith("created"))  return "created";
  if (mode.startsWith("updated"))  return "updated";
  if (mode.startsWith("tokens"))   return "tokens";
  return "custom";
}

// ─── Sort functions ─────────────────────────────────────────────────────────

export function applySortGoals(
  items: Goal[],
  mode: SortMode,
  tokensByGoal?: Map<string, number>,
): Goal[] {
  if (mode === "custom") return items; // already ordered by sort_order from DB
  const sorted = [...items];
  switch (mode) {
    case "alpha_asc":
      sorted.sort((a, b) => (a.name || a.description).localeCompare(b.name || b.description));
      break;
    case "alpha_desc":
      sorted.sort((a, b) => (b.name || b.description).localeCompare(a.name || a.description));
      break;
    case "created_asc":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "created_desc":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "updated_asc":
      sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      break;
    case "updated_desc":
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "tokens_asc":
      sorted.sort((a, b) => (tokensByGoal?.get(a.id) ?? 0) - (tokensByGoal?.get(b.id) ?? 0));
      break;
    case "tokens_desc":
      sorted.sort((a, b) => (tokensByGoal?.get(b.id) ?? 0) - (tokensByGoal?.get(a.id) ?? 0));
      break;
  }
  return sorted;
}

export function applySortJobs(
  items: Job[],
  mode: SortMode,
  tokensByJob?: Map<string, number>,
): Job[] {
  if (mode === "custom") return items;
  const sorted = [...items];
  switch (mode) {
    case "alpha_asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "alpha_desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "created_asc":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "created_desc":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "updated_asc":
      sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      break;
    case "updated_desc":
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "tokens_asc":
      sorted.sort((a, b) => (tokensByJob?.get(a.id) ?? 0) - (tokensByJob?.get(b.id) ?? 0));
      break;
    case "tokens_desc":
      sorted.sort((a, b) => (tokensByJob?.get(b.id) ?? 0) - (tokensByJob?.get(a.id) ?? 0));
      break;
  }
  return sorted;
}

// ─── SortDropdown component ─────────────────────────────────────────────────

export function SortDropdown({
  value,
  onChange,
  label,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCategory = modeToCategory(value);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!ref.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }, []);

  const handleRowClick = (cat: SortCategory, def: CategoryDef) => {
    if (cat === activeCategory) {
      // Toggle direction if already selected
      onChange(value === def.asc ? def.desc : def.asc);
    } else {
      // Select this category with its default direction
      onChange(def.defaultDir === "asc" ? def.asc : def.desc);
    }
    setOpen(false);
  };

  const handleArrowClick = (e: React.MouseEvent, def: CategoryDef) => {
    e.stopPropagation();
    onChange(value === def.asc ? def.desc : def.asc);
    setOpen(false);
  };

  const isActive = value !== "custom";
  const activeLabel = CATEGORIES.find((c) => c.key === activeCategory)?.def.label ?? "";

  return (
    <div ref={ref} className="relative inline-flex items-center" onBlur={handleBlur}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          isActive && "text-primary",
        )}
        title={`Sort ${label}: ${activeLabel}${isActive ? (value.endsWith("_desc") ? " ↓" : " ↑") : ""}`}
      >
        <ArrowUpDown className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[148px] rounded-md border border-sidebar-border bg-sidebar py-1 shadow-lg">
          {CATEGORIES.map(({ key, def }) => {
            const isCurrent = key === activeCategory;
            const isDesc = isCurrent && value === def.desc;
            return (
              <button
                key={key}
                onClick={() => handleRowClick(key, def)}
                className={cn(
                  "flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-accent",
                  isCurrent ? "font-medium text-primary" : "text-sidebar-foreground",
                )}
              >
                <span className="flex-1">{def.label}</span>
                {key !== "custom" && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleArrowClick(e, def)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleArrowClick(e as unknown as React.MouseEvent, def);
                      }
                    }}
                    className={cn(
                      "rounded p-0.5 hover:bg-sidebar-border",
                      isCurrent ? "text-primary" : "text-muted-foreground/50",
                    )}
                  >
                    {isDesc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
