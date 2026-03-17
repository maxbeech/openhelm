import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Waypoints } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useMemoryStore } from "@/stores/memory-store";
import { useProjectStore } from "@/stores/project-store";
import { MemoryFilters } from "./memory-filters";
import { MemoryCard } from "./memory-card";
import { MemoryCreateDialog } from "./memory-create-dialog";
import { MemoryEditDialog } from "./memory-edit-dialog";
import { Button } from "@/components/ui/button";
import type { Memory, MemoryType } from "@openorchestra/shared";

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
    await pruneMemories(activeProjectId);
    await fetchMemories(activeProjectId);
    setPruning(false);
  }, [activeProjectId, pruneMemories, fetchMemories]);

  // Resolve project name for cross-project view
  const getProjectName = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.name,
    [projects],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="space-y-6 px-6 pt-14 pb-8">
        {/* Filters */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Filters</h3>
            <div className="ml-auto flex items-center gap-2">
              {activeProjectId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  disabled={pruning}
                  onClick={handlePrune}
                >
                  <Trash2 className="mr-1 size-3" />
                  {pruning ? "Pruning..." : "Prune"}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="text-[11px]"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="mr-1 size-3" />
                New Memory
              </Button>
            </div>
          </div>
          <MemoryFilters tags={allTags} />
        </section>

        {/* Memory list */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Memories{memories.length > 0 && ` (${memories.length})`}
          </h3>
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
                  onEdit={setEditingMemory}
                  onDelete={handleDelete}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          )}
        </section>
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
