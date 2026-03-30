import { useState, useEffect } from "react";
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
import { useDataTableStore } from "@/stores/data-table-store";
import type {
  CreateTargetParams,
  TargetDirection,
  TargetAggregation,
} from "@openhelm/shared";

interface TargetCreateFormProps {
  goalId?: string;
  jobId?: string;
  projectId: string;
  onSubmit: (params: CreateTargetParams) => Promise<void>;
  onCancel: () => void;
}

export function TargetCreateForm({
  goalId,
  jobId,
  projectId,
  onSubmit,
  onCancel,
}: TargetCreateFormProps) {
  const { tables, fetchTables } = useDataTableStore();
  const [tableId, setTableId] = useState("");
  const [columnId, setColumnId] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [direction, setDirection] = useState<TargetDirection>("gte");
  const [aggregation, setAggregation] = useState<TargetAggregation>("latest");
  const [label, setLabel] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTables(projectId);
  }, [projectId, fetchTables]);

  const selectedTable = tables.find((t) => t.id === tableId);
  const numberColumns = selectedTable?.columns.filter((c) => c.type === "number") ?? [];

  const handleSubmit = async () => {
    if (!tableId || !columnId || !targetValue) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        goalId,
        jobId,
        projectId,
        dataTableId: tableId,
        columnId,
        targetValue: Number(targetValue),
        direction,
        aggregation,
        label: label || undefined,
        deadline: deadline || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create target");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Data Table</Label>
          <Select value={tableId} onValueChange={(v) => { setTableId(v); setColumnId(""); }}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select table..." />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Column (number)</Label>
          <Select value={columnId} onValueChange={setColumnId} disabled={!tableId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select column..." />
            </SelectTrigger>
            <SelectContent>
              {numberColumns.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
              {numberColumns.length === 0 && tableId && (
                <div className="px-2 py-1 text-xs text-muted-foreground">No number columns</div>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Target Value</Label>
          <Input
            type="number"
            className="h-8 text-xs"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="e.g. 80"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Direction</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as TargetDirection)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gte">At least (&ge;)</SelectItem>
              <SelectItem value="lte">At most (&le;)</SelectItem>
              <SelectItem value="eq">Exactly (=)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Aggregation</Label>
          <Select value={aggregation} onValueChange={(v) => setAggregation(v as TargetAggregation)}>
            <SelectTrigger className="h-8 text-xs">
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Label (optional)</Label>
          <Input
            className="h-8 text-xs"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Test Coverage %"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Deadline (optional)</Label>
          <Input
            type="date"
            className="h-8 text-xs"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!tableId || !columnId || !targetValue || submitting}
        >
          {submitting ? "Creating..." : "Add Target"}
        </Button>
      </div>
    </div>
  );
}
