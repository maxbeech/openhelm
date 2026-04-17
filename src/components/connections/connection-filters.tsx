import { useConnectionStore } from "@/stores/connection-store";
import { FilterBar } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import type { ConnectionType } from "@openhelm/shared";

const typeOptions: { value: ConnectionType; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "mcp", label: "MCP" },
  { value: "cli", label: "CLI" },
  { value: "browser", label: "Browser" },
  { value: "token", label: "Token" },
  { value: "plain_text", label: "Password" },
];

export function ConnectionFilters() {
  const { filterType, searchQuery, setFilterType, setSearchQuery } = useConnectionStore();

  return (
    <FilterBar
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search connections..."
    >
      {typeOptions.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={filterType === opt.value ? "secondary" : "ghost"}
          className="h-8 text-2xs"
          onClick={() => setFilterType(filterType === opt.value ? null : opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </FilterBar>
  );
}
