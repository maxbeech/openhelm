import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Target } from "lucide-react";
import { TargetProgressBar } from "./target-progress-bar";
import { TargetCreateForm } from "./target-create-form";
import { useTargetStore } from "@/stores/target-store";
import { useDataTableStore } from "@/stores/data-table-store";
import type { TargetEvaluation, CreateTargetParams } from "@openhelm/shared";

interface TargetListProps {
  goalId?: string;
  jobId?: string;
  projectId: string;
}

export function TargetList({ goalId, jobId, projectId }: TargetListProps) {
  const {
    targets,
    evaluations,
    loading,
    fetchTargets,
    fetchEvaluations,
    createTarget,
    deleteTarget,
  } = useTargetStore();
  const { tables, fetchTables } = useDataTableStore();
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(() => {
    const params = goalId ? { goalId } : jobId ? { jobId } : {};
    fetchTargets(params);
    if (goalId || jobId) {
      fetchEvaluations({ goalId, jobId });
    }
  }, [goalId, jobId, fetchTargets, fetchEvaluations]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (params: CreateTargetParams) => {
    await createTarget(params);
    setShowForm(false);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await deleteTarget(id);
    loadData();
  };

  const getEvaluation = (targetId: string): TargetEvaluation | undefined =>
    evaluations.find((e) => e.targetId === targetId);

  const resolveColumnName = (dataTableId: string, columnId: string): string => {
    const table = tables.find((t) => t.id === dataTableId);
    if (!table) return columnId;
    const col = table.columns.find((c) => c.id === columnId);
    return col ? `${col.name} (${table.name})` : columnId;
  };

  // Fetch table metadata for column name resolution
  useEffect(() => {
    if (targets.length > 0) {
      fetchTables(projectId);
    }
  }, [targets.length, projectId, fetchTables]);

  if (loading && targets.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">Loading targets...</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Targets
        </h3>
        {!showForm && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </div>

      {showForm && (
        <TargetCreateForm
          goalId={goalId}
          jobId={jobId}
          projectId={projectId}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {targets.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground py-1">
          No targets set. Add a target to track progress toward a numerical goal.
        </p>
      )}

      {targets.map((target) => {
        const ev = getEvaluation(target.id);
        const displayLabel = target.label ?? resolveColumnName(target.dataTableId, target.columnId);

        return (
          <div
            key={target.id}
            className="group rounded-lg border p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{displayLabel}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(target.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>

            {ev && <TargetProgressBar evaluation={ev} />}

            {target.deadline && (
              <div className="text-xs text-muted-foreground">
                Deadline: {new Date(target.deadline).toLocaleDateString()}
                {ev?.isOverdue && (
                  <span className="text-red-500 ml-1 font-medium">Overdue</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
