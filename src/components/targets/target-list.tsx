import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Target, Check, X } from "lucide-react";
import { TargetProgressBar } from "./target-progress-bar";
import { TargetCreateForm } from "./target-create-form";
import { useTargetStore } from "@/stores/target-store";
import { useDataTableStore } from "@/stores/data-table-store";
import type { TargetEvaluation, CreateTargetParams, TargetDirection, TargetAggregation, Target as TargetType } from "@openhelm/shared";

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
    error,
    fetchTargets,
    fetchEvaluations,
    createTarget,
    updateTarget,
    deleteTarget,
  } = useTargetStore();
  const { tables, fetchTables } = useDataTableStore();
  const [showForm, setShowForm] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);

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
    if (!window.confirm("Delete this target? This cannot be undone.")) return;
    await deleteTarget(id);
    loadData();
  };

  const handleUpdate = async (id: string, values: {
    targetValue: number;
    direction: TargetDirection;
    aggregation: TargetAggregation;
    label: string;
    deadline: string;
  }) => {
    await updateTarget({
      id,
      targetValue: values.targetValue,
      direction: values.direction,
      aggregation: values.aggregation,
      label: values.label || null,
      deadline: values.deadline || null,
    });
    setEditingTargetId(null);
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

  if (error) {
    return (
      <div className="text-xs text-destructive py-2">{error}</div>
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
        const isEditing = editingTargetId === target.id;

        return (
          <div key={target.id} className="group rounded-lg border p-3 space-y-2">
            {isEditing ? (
              <TargetEditForm
                target={target}
                onSave={(values) => handleUpdate(target.id, values)}
                onCancel={() => setEditingTargetId(null)}
              />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{displayLabel}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setEditingTargetId(target.id)}
                      title="Edit target"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleDelete(target.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
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
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Inline edit form ───────────────────────────────────────────────────────

function TargetEditForm({
  target,
  onSave,
  onCancel,
}: {
  target: TargetType;
  onSave: (values: { targetValue: number; direction: TargetDirection; aggregation: TargetAggregation; label: string; deadline: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [targetValue, setTargetValue] = useState(String(target.targetValue));
  const [direction, setDirection] = useState<TargetDirection>(target.direction);
  const [aggregation, setAggregation] = useState<TargetAggregation>(target.aggregation);
  const [label, setLabel] = useState(target.label ?? "");
  const [deadline, setDeadline] = useState(
    target.deadline ? target.deadline.split("T")[0] : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!targetValue) return;
    setSaving(true);
    await onSave({ targetValue: Number(targetValue), direction, aggregation, label, deadline });
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Target Value</Label>
          <Input
            type="number"
            className="h-7 text-xs"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Direction</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as TargetDirection)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gte">At least (≥)</SelectItem>
              <SelectItem value="lte">At most (≤)</SelectItem>
              <SelectItem value="eq">Exactly (=)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Aggregation</Label>
          <Select value={aggregation} onValueChange={(v) => setAggregation(v as TargetAggregation)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest</SelectItem>
              <SelectItem value="sum">Sum</SelectItem>
              <SelectItem value="avg">Average</SelectItem>
              <SelectItem value="max">Max</SelectItem>
              <SelectItem value="min">Min</SelectItem>
              <SelectItem value="count">Count</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Label (optional)</Label>
          <Input
            className="h-7 text-xs"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Display name"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Deadline (optional)</Label>
          <Input
            type="date"
            className="h-7 text-xs"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onCancel}>
          <X className="h-3 w-3 mr-1" />Cancel
        </Button>
        <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave} disabled={!targetValue || saving}>
          <Check className="h-3 w-3 mr-1" />{saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
