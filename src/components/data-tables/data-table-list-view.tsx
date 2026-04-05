import { useEffect, useState, useMemo, useCallback } from "react";
import { Plus, Database, ChevronDown } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataTableStore } from "@/stores/data-table-store";
import { useProjectStore } from "@/stores/project-store";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { Switch } from "@/components/ui/switch";
import { DataTableCard } from "./data-table-card";
import { DataTableCreateDialog } from "./data-table-create-dialog";

export function DataTableListView() {
  const { activeProjectId, selectDataTable } = useAppStore();
  const { tables, loading, fetchTables, fetchCount, deleteTable } = useDataTableStore();
  const { projects } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [showSystemTables, setShowSystemTables] = useState(true);

  useEffect(() => {
    fetchTables(activeProjectId);
    fetchCount(activeProjectId);
  }, [activeProjectId, fetchTables, fetchCount]);

  // Reset filters when switching project context
  useEffect(() => {
    setSearchQuery("");
    setFilterProjectId(null);
    setShowSystemTables(true);
  }, [activeProjectId]);

  const getProjectName = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.name,
    [projects],
  );

  const filtered = useMemo(() => {
    let result = tables;
    if (!showSystemTables) {
      result = result.filter((t) => !t.isSystem);
    }
    if (filterProjectId) {
      result = result.filter((t) => t.projectId === filterProjectId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [tables, showSystemTables, filterProjectId, searchQuery]);

  const handleDelete = async (id: string) => {
    await deleteTable(id);
    fetchTables(activeProjectId);
    fetchCount(activeProjectId);
  };

  const handleCreated = () => {
    setShowCreate(false);
    fetchTables(activeProjectId);
    fetchCount(activeProjectId);
  };

  // Show project filter only when viewing "All Projects"
  const showProjectFilter = !activeProjectId && projects.length > 1;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Data Tables"
        subtitle="Structured data that you and your AI jobs can read and write."
        count={filtered.length}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-3.5" />
            New Table
          </button>
        }
        filters={
          <FilterBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search tables..."
          >
            {showProjectFilter && (
              <div className="relative">
                <select
                  value={filterProjectId ?? ""}
                  onChange={(e) => setFilterProjectId(e.target.value || null)}
                  className="h-8 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            )}
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground hover:bg-accent/30">
              <Switch
                size="sm"
                checked={showSystemTables}
                onCheckedChange={setShowSystemTables}
              />
              System tables
            </label>
          </FilterBar>
        }
      />

      {/* Table list */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Database className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {searchQuery || filterProjectId || !showSystemTables
                ? "No tables match your filters"
                : "No data tables yet"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              {searchQuery || filterProjectId || !showSystemTables
                ? "Try adjusting your search or filters."
                : "Create a table manually or let your AI jobs create them as they work."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {filtered.map((table) => (
              <DataTableCard
                key={table.id}
                table={table}
                projectName={!activeProjectId ? getProjectName(table.projectId) : undefined}
                onClick={() => selectDataTable(table.id)}
                onDelete={() => handleDelete(table.id)}
              />
            ))}
          </div>
        )}
      </div>

      <DataTableCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        projectId={activeProjectId}
        onCreated={handleCreated}
      />
    </div>
  );
}
