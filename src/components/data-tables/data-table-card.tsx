import { Trash2, Bot, User, FolderOpen } from "lucide-react";
import type { DataTable } from "@openhelm/shared";
import { ColumnTypeIcon } from "./column-type-icon";

interface DataTableCardProps {
  table: DataTable;
  projectName?: string;
  onClick: () => void;
  onDelete: () => void;
}

export function DataTableCard({ table, projectName, onClick, onDelete }: DataTableCardProps) {
  const timeAgo = getTimeAgo(table.updatedAt);

  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/30 hover:bg-accent/30"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{table.name}</h3>
          {table.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {table.description}
            </p>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-2 flex size-6 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
          title="Delete table"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Columns preview */}
      {table.columns.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {table.columns.slice(0, 5).map((col) => (
            <span
              key={col.id}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground"
            >
              <ColumnTypeIcon type={col.type} className="size-2.5" />
              {col.name}
            </span>
          ))}
          {table.columns.length > 5 && (
            <span className="text-3xs text-muted-foreground/60">
              +{table.columns.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center gap-3 text-3xs text-muted-foreground/70">
        {projectName && (
          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
            <FolderOpen className="size-2.5" />
            {projectName}
          </span>
        )}
        <span>{table.rowCount} rows</span>
        <span>{table.columns.length} columns</span>
        <span className="ml-auto flex items-center gap-1">
          {table.createdBy === "ai" ? <Bot className="size-2.5" /> : <User className="size-2.5" />}
          {timeAgo}
        </span>
      </div>
    </button>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
