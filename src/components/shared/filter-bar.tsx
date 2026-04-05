import { Search } from "lucide-react";
import type { ReactNode } from "react";

interface FilterBarProps {
  /** Search input value — omit to hide search */
  searchValue?: string;
  /** Search change handler */
  onSearchChange?: (value: string) => void;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** Custom filter controls rendered after the search input */
  children?: ReactNode;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  children,
}: FilterBarProps) {
  const showSearch = searchValue !== undefined && onSearchChange !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSearch && (
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
      {children}
    </div>
  );
}
