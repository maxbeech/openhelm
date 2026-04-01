import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
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
import { useVisualizationStore } from "@/stores/visualization-store";
import type { ChartType, DataTableColumn, VisualizationConfig } from "@openhelm/shared";

interface Props {
  projectId: string;
  goalId?: string;
  jobId?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function ChartCreateDialog({ projectId, goalId, jobId, onClose, onCreated }: Props) {
  const { tables, fetchTables } = useDataTableStore();
  const { createVisualization } = useVisualizationStore();

  const [name, setName] = useState("");
  const [tableId, setTableId] = useState("");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [xColumnId, setXColumnId] = useState("");
  const [yColumnIds, setYColumnIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchTables(projectId);
  }, [projectId, fetchTables]);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === tableId),
    [tables, tableId],
  );

  const numericColumns = useMemo(
    () => selectedTable?.columns.filter((c) => c.type === "number") ?? [],
    [selectedTable],
  );

  const xAxisColumns = useMemo(
    () => selectedTable?.columns.filter((c) => ["date", "text", "select"].includes(c.type)) ?? [],
    [selectedTable],
  );

  const toggleYColumn = (colId: string) => {
    setYColumnIds((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId],
    );
  };

  const canSubmit = name.trim() && tableId && (
    chartType === "stat"
      ? yColumnIds.length === 1
      : chartType === "pie"
        ? yColumnIds.length >= 1
        : yColumnIds.length >= 1
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    let config: VisualizationConfig;

    if (chartType === "stat") {
      config = {
        series: [],
        statColumnId: yColumnIds[0],
        statAggregation: "latest",
      };
    } else if (chartType === "pie") {
      config = {
        series: [],
        valueColumnId: yColumnIds[0],
        labelColumnId: xColumnId || undefined,
        showLegend: true,
      };
    } else {
      config = {
        xColumnId: xColumnId || undefined,
        series: yColumnIds.map((colId) => {
          const col = selectedTable?.columns.find((c) => c.id === colId);
          return { columnId: colId, label: col?.name };
        }),
        showLegend: yColumnIds.length > 1,
        showGrid: true,
      };
    }

    await createVisualization({
      projectId,
      goalId,
      jobId,
      dataTableId: tableId,
      name: name.trim(),
      chartType,
      config,
    });

    setSubmitting(false);
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-popover border rounded-lg shadow-lg w-full max-w-md p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">New Chart</h3>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Revenue Over Time"
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Data Table</Label>
            <Select value={tableId} onValueChange={(v) => { setTableId(v); setXColumnId(""); setYColumnIds([]); }}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a table" />
              </SelectTrigger>
              <SelectContent>
                {tables.filter((t) => t.id).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.rowCount} rows)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Chart Type</Label>
            <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="bar">Bar</SelectItem>
                <SelectItem value="area">Area</SelectItem>
                <SelectItem value="pie">Pie</SelectItem>
                <SelectItem value="stat">Stat (Single Number)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedTable && chartType !== "stat" && (
            <div>
              <Label className="text-xs">
                {chartType === "pie" ? "Label Column" : "X-Axis Column"} (optional)
              </Label>
              <Select
                value={xColumnId || "__none__"}
                onValueChange={(v) => setXColumnId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="None (use row index)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (use row index)</SelectItem>
                  {xAxisColumns.filter((c) => c.id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedTable && numericColumns.length > 0 && (
            <div>
              <Label className="text-xs">
                {chartType === "stat" ? "Value Column" : chartType === "pie" ? "Value Column" : "Y-Axis Columns"}
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {numericColumns.map((col) => {
                  const selected = yColumnIds.includes(col.id);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => {
                        if (chartType === "stat" || chartType === "pie") {
                          setYColumnIds([col.id]);
                        } else {
                          toggleYColumn(col.id);
                        }
                      }}
                      className={`px-2 py-1 rounded text-xs border transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-accent"
                      }`}
                    >
                      {col.name}
                    </button>
                  );
                })}
              </div>
              {numericColumns.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">No numeric columns in this table</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "Creating…" : "Create Chart"}
          </Button>
        </div>
      </div>
    </div>
  );
}
