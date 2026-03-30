import type { DataTable, RollupAggregation } from "@openhelm/shared";

export const AGGREGATIONS: { value: RollupAggregation; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "count_values", label: "Count values" },
  { value: "count_unique", label: "Count unique" },
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "percent_empty", label: "% Empty" },
  { value: "percent_not_empty", label: "% Not empty" },
  { value: "show_original", label: "Show original" },
];

export function RelationConfig({ availableTables, targetTableId, reciprocal, onTargetChange, onReciprocalChange }: {
  availableTables: DataTable[];
  targetTableId: string;
  reciprocal: boolean;
  onTargetChange: (id: string) => void;
  onReciprocalChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <select
        value={targetTableId}
        onChange={(e) => onTargetChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Select target table...</option>
        {availableTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={reciprocal}
          onChange={(e) => onReciprocalChange(e.target.checked)}
          className="size-3 rounded border-input"
        />
        Two-way relation
      </label>
    </div>
  );
}

export function RollupConfigUI({ relationColumns, rollupRelationColId, rollupSourceColId, rollupAggregation, targetTable, onRelationChange, onSourceChange, onAggregationChange }: {
  relationColumns: { id: string; name: string }[];
  rollupRelationColId: string;
  rollupSourceColId: string;
  rollupAggregation: RollupAggregation;
  targetTable?: DataTable;
  onRelationChange: (id: string) => void;
  onSourceChange: (id: string) => void;
  onAggregationChange: (agg: RollupAggregation) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] font-medium text-muted-foreground">Relation</label>
        <select
          value={rollupRelationColId}
          onChange={(e) => onRelationChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select relation column...</option>
          {relationColumns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {targetTable && (
        <div>
          <label className="text-[10px] font-medium text-muted-foreground">Property</label>
          <select
            value={rollupSourceColId}
            onChange={(e) => onSourceChange(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select column...</option>
            {targetTable.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="text-[10px] font-medium text-muted-foreground">Aggregation</label>
        <select
          value={rollupAggregation}
          onChange={(e) => onAggregationChange(e.target.value as RollupAggregation)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
    </div>
  );
}
