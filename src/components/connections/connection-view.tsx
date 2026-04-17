import { useEffect, useState, useCallback } from "react";
import { Plus, Plug } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useConnectionStore } from "@/stores/connection-store";
import { PageHeader } from "@/components/shared/page-header";
import { ConnectionFilters } from "./connection-filters";
import { ConnectionCard } from "./connection-card";
import { ConnectionCreateDialog } from "./connection-create-dialog";
import { ConnectionEditDialog } from "./connection-edit-dialog";
import { Button } from "@/components/ui/button";
import type { Connection, CreateConnectionParams, UpdateConnectionParams } from "@openhelm/shared";

export function ConnectionView() {
  const { activeProjectId } = useAppStore();
  const {
    connections,
    loading,
    filterType,
    searchQuery,
    fetchConnections,
    createConnection,
    updateConnection,
    deleteConnection,
  } = useConnectionStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [crudError, setCrudError] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections(activeProjectId);
  }, [activeProjectId, filterType, fetchConnections]);

  const filtered = connections.filter((c) => {
    if (filterType && c.type !== filterType) return false;
    if (searchQuery.trim() && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCreate = useCallback(
    async (data: CreateConnectionParams & { scopes: Connection["scopes"] }) => {
      setCrudError(null);
      try {
        const result = await createConnection(data);
        fetchConnections(activeProjectId);
        return result;
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to create connection");
        throw err;
      }
    },
    [activeProjectId, createConnection, fetchConnections],
  );

  const handleEdit = useCallback(
    async (data: UpdateConnectionParams) => {
      setCrudError(null);
      try {
        await updateConnection(data);
        fetchConnections(activeProjectId);
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to update connection");
      }
    },
    [activeProjectId, updateConnection, fetchConnections],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setCrudError(null);
      try {
        await deleteConnection(id);
        fetchConnections(activeProjectId);
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to delete connection");
      }
    },
    [activeProjectId, deleteConnection, fetchConnections],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Connections"
        subtitle="API keys, browser sessions, MCP servers, CLI tools, and local folders for your jobs."
        count={filtered.length}
        actions={
          <Button size="sm" variant="secondary" className="text-2xs" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 size-3" />
            New Connection
          </Button>
        }
        filters={<ConnectionFilters />}
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {crudError && (
          <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {crudError}
          </div>
        )}
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading connections...</p>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <Plug className="mx-auto mb-3 size-10 text-muted-foreground/30" />
            <p className="mb-3 text-sm text-muted-foreground">
              {filterType ? "No connections match your filters." : "No connections yet. Add API tokens, browser sessions, or MCP servers."}
            </p>
            {!filterType && (
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                <Plus className="mr-1.5 size-3.5" />
                Add Connection
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                onEdit={setEditingConnection}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ConnectionCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSave={handleCreate}
      />
      <ConnectionEditDialog
        open={!!editingConnection}
        onOpenChange={(open) => { if (!open) setEditingConnection(null); }}
        connection={editingConnection}
        onSave={handleEdit}
      />
    </div>
  );
}
