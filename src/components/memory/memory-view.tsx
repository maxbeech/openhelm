import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Waypoints, CheckSquare } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useMemoryStore } from "@/stores/memory-store";
import { useProjectStore } from "@/stores/project-store";
import { PageHeader } from "@/components/shared/page-header";
import { MemoryFilters } from "./memory-filters";
import { MemoryCard } from "./memory-card";
import { MemoryCreateDialog } from "./memory-create-dialog";
import { MemoryEditDialog } from "./memory-edit-dialog";
import { Button } from "@/components/ui/button";
import type { Memory, MemoryType } from "@openhelm/shared";

export function MemoryView() {
  const { activeProjectId } = useAppStore();
  const { projects } = useProjectStore();
  const {
    memories,
    allTags,
    loading,
    filterType,
    filterTag,
    searchQuery,
    showArchived,
    fetchMemories,
    fetchTags,
    createMemory,
    updateMemory,
    deleteMemory,
    archiveMemory,
    pruneMemories,
  } = useMemoryStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [pruning, setPruning] = useState(false);
  const [pruneResult, setPruneResult] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Clear selection when memories change (e.g. after filter)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterType, filterTag, searchQuery, showArchived, activeProjectId]);

  // Fetch when filters or project changes
  useEffect(() => {
    fetchMemories(activeProjectId);
    fetchTags(activeProjectId);
  }, [activeProjectId, filterType, filterTag, searchQuery, showArchived, fetchMemories, fetchTags]);

  const handleCreate = useCallback(
    async (data: { type: MemoryType; content: string; importance: number; tags: string[]; projectId: string }) => {
      await createMemory({
        projectId: data.projectId,
        type: data.type,
        content: data.content,
        sourceType: "user",
        importance: data.importance,
        tags: data.tags,
      });
      fetchMemories(activeProjectId);
    },
    [activeProjectId, createMemory, fetchMemories],
  );

  const handleEdit = useCallback(
    async (data: { id: string; type: MemoryType; content: string; importance: number; tags: string[] }) => {
      await updateMemory(data);
      fetchMemories(activeProjectId);
    },
    [activeProjectId, updateMemory, fetchMemories],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMemory(id);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      fetchMemories(activeProjectId);
    },
    [activeProjectId, deleteMemory, fetchMemories],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      await archiveMemory(id);
      fetchMemories(activeProjectId);
    },
    [activeProjectId, archiveMemory, fetchMemories],
  );

  const handlePrune = useCallback(async () => {
    if (!activeProjectId) return;
    setPruning(true);
    setPruneResult(null);
    try {
      const pruned = await pruneMemories(activeProjectId);
      await fetchMemories(activeProjectId);
      setPruneResult(pruned);
      setTimeout(() => setPruneResult(null), 4000);
    } catch (err) {
      console.error("[memory-view] prune error:", err);
    } finally {
      setPruning(false);
    }
  }, [activeProjectId, pruneMemories, fetchMemories]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(memories.map((m) => m.id)));
  }, [memories]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }
    setBulkDeleting(true);
    setConfirmBulkDelete(false);
    try {
      for (const id of selectedIds) {
        await deleteMemory(id);
      }
      setSelectedIds(new Set());
      await fetchMemories(activeProjectId);
    } catch (err) {
      console.error("[memory-view] bulk delete error:", err);
    } finally {
      setBulkDeleting(false);
    }
  }, [confirmBulkDelete, selectedIds, deleteMemory, fetchMemories, activeProjectId]);

  // Resolve project name for cross-project view
  const getProjectName = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.name,
    [projects],
  );

  const allSelected = memories.length > 0 && selectedIds.size === memories.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Memories"
        subtitle="Automatically extracted from runs, or created manually."
        count={memories.length}
        actions={
          <div className="flex items-center gap-2">
            {activeProjectId && (
              <Button
                size="sm"
                variant="ghost"
                className="text-2xs text-muted-foreground hover:text-foreground"
                disabled={pruning}
                onClick={handlePrune}
                title="Auto-archive stale, low-importance memories and enforce the 200-memory cap"
              >
                <Trash2 className="mr-1 size-3" />
                {pruning
                  ? "Pruning..."
                  : pruneResult !== null
                    ? pruneResult === 0
                      ? "Nothing to prune"
                      : `Archived ${pruneResult}`
                    : "Auto-prune"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="text-2xs"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="mr-1 size-3" />
              New Memory
            </Button>
          </div>
        }
        filters={<MemoryFilters tags={allTags} />}
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Bulk action bar */}
        {someSelected && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-2xs text-muted-foreground">
              {selectedIds.size} selected
            </span>
            {!allSelected && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-2xs text-muted-foreground hover:text-foreground"
                onClick={handleSelectAll}
              >
                <CheckSquare className="size-3" />
                Select all
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-2xs text-muted-foreground hover:text-foreground"
              onClick={handleClearSelection}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant={confirmBulkDelete ? "destructive" : "outline"}
              className="h-7 gap-1 text-2xs"
              disabled={bulkDeleting}
              onClick={handleBulkDelete}
            >
              <Trash2 className="size-3" />
              {bulkDeleting
                ? "Deleting..."
                : confirmBulkDelete
                  ? `Confirm delete ${selectedIds.size}`
                  : `Delete ${selectedIds.size}`}
            </Button>
          </div>
        )}

        {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading memories...
            </p>
          ) : memories.length === 0 ? (
            <div className="py-8 text-center">
              <Waypoints className="mx-auto mb-3 size-10 text-muted-foreground/30" />
              <p className="mb-3 text-sm text-muted-foreground">
                No memories yet. Memories are automatically extracted from runs,
                or you can create them manually.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="mr-1.5 size-3.5" />
                Create Memory
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((mem) => (
                <MemoryCard
                  key={mem.id}
                  memory={mem}
                  projectName={!activeProjectId ? getProjectName(mem.projectId) : undefined}
                  isSelected={selectedIds.has(mem.id)}
                  onToggleSelect={handleToggleSelect}
                  onEdit={setEditingMemory}
                  onDelete={handleDelete}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          )}
      </div>

      {/* Dialogs */}
      <MemoryCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        projectId={activeProjectId}
        onSave={handleCreate}
      />
      <MemoryEditDialog
        open={!!editingMemory}
        onOpenChange={(open) => { if (!open) setEditingMemory(null); }}
        memory={editingMemory}
        onSave={handleEdit}
      />
    </div>
  );
}
