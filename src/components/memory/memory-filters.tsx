import { Search, ChevronDown } from "lucide-react";
import { useMemoryStore } from "@/stores/memory-store";
import { Switch } from "@/components/ui/switch";
import type { MemoryType } from "@openhelm/shared";

const TYPES: Array<{ value: MemoryType | ""; label: string }> = [
  { value: "", label: "All Types" },
  { value: "semantic", label: "Facts" },
  { value: "episodic", label: "Experiences" },
  { value: "procedural", label: "Workflows" },
  { value: "source", label: "Sources" },
];

interface MemoryFiltersProps {
  tags: string[];
}

export function MemoryFilters({ tags }: MemoryFiltersProps) {
  const {
    filterType,
    filterTag,
    searchQuery,
    showArchived,
    setFilterType,
    setFilterTag,
    setSearchQuery,
    setShowArchived,
  } = useMemoryStore();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative min-w-[180px] flex-1">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Type filter */}
      <div className="relative">
        <select
          value={filterType ?? ""}
          onChange={(e) =>
            setFilterType((e.target.value || null) as MemoryType | null)
          }
          className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>

      {/* Tag filter */}
      {tags.length > 0 && (
        <div className="relative">
          <select
            value={filterTag ?? ""}
            onChange={(e) => setFilterTag(e.target.value || null)}
            className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All Tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      )}

      {/* Archived toggle */}
      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground hover:bg-accent/30">
        <Switch
          size="sm"
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        Show archived
      </label>
    </div>
  );
}
