import type { ReactNode } from "react";

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Item count shown next to title */
  count?: number;
  /** Action buttons (top-right) */
  actions?: ReactNode;
  /** Filter bar content (below title row) */
  filters?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  count,
  actions,
  filters,
}: PageHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border px-6 py-4 space-y-3">
      {/* Title row */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">
            {title}
            {count !== undefined && count > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({count})
              </span>
            )}
          </h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>

      {/* Filter bar */}
      {filters}
    </div>
  );
}
