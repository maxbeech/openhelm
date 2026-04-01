import { useEffect, useState } from "react";
import { Plus, Database } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataTableStore } from "@/stores/data-table-store";
import { DataTableCard } from "./data-table-card";
import { DataTableCreateDialog } from "./data-table-create-dialog";

export function DataTableListView() {
  const { activeProjectId, selectDataTable } = useAppStore();
  const { tables, loading, fetchTables, fetchCount, deleteTable } = useDataTableStore();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchTables(activeProjectId);
    fetchCount(activeProjectId);
  }, [activeProjectId, fetchTables, fetchCount]);

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Data Tables</h1>
          <p className="text-xs text-muted-foreground">
            Structured data that you and your AI jobs can read and write.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-3.5" />
          New Table
        </button>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Database className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No data tables yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              Create a table manually or let your AI jobs create them as they work.
            </p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {tables.map((table) => (
              <DataTableCard
                key={table.id}
                table={table}
                onClick={() => selectDataTable(table.id)}
                onDelete={() => handleDelete(table.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <DataTableCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        projectId={activeProjectId}
        onCreated={handleCreated}
      />
    </div>
  );
}
