import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import type { DataTableColumnType, DataTable, RollupAggregation } from "@openhelm/shared";
import { ColumnTypeIcon } from "./column-type-icon";
import { RelationConfig, RollupConfigUI } from "./add-column-configs";

interface Props {
  onAdd: (name: string, type: DataTableColumnType, config?: Record<string, unknown>) => void;
  onClose: () => void;
  tables?: DataTable[];
  currentTableId?: string;
  currentColumns?: { id: string; name: string; type: string; config: Record<string, unknown> }[];
}

const COLUMN_TYPES: { value: DataTableColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "files", label: "Files & Media" },
  { value: "relation", label: "Relation" },
  { value: "rollup", label: "Rollup" },
  { value: "formula", label: "Formula" },
  { value: "created_time", label: "Created Time" },
  { value: "updated_time", label: "Updated Time" },
];

export function DataTableAddColumn({ onAdd, onClose, tables, currentTableId, currentColumns }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<DataTableColumnType>("text");
  const inputRef = useRef<HTMLInputElement>(null);

  // Relation config
  const [targetTableId, setTargetTableId] = useState("");
  const [reciprocal, setReciprocal] = useState(true);

  // Rollup config
  const [rollupRelationColId, setRollupRelationColId] = useState("");
  const [rollupSourceColId, setRollupSourceColId] = useState("");
  const [rollupAggregation, setRollupAggregation] = useState<RollupAggregation>("count");

  // Formula config
  const [formulaExpression, setFormulaExpression] = useState("");

  useEffect(() => { inputRef.current?.focus(); }, []);

  const isRelation = type === "relation";
  const isRollup = type === "rollup";
  const isFormula = type === "formula";
  const availableTables = (tables ?? []).filter((t) => t.id !== currentTableId);
  const relationColumns = (currentColumns ?? []).filter((c) => c.type === "relation");

  // Get target table columns for rollup source
  const selectedRelCol = relationColumns.find((c) => c.id === rollupRelationColId);
  const rollupTargetTableId = (selectedRelCol?.config as { targetTableId?: string })?.targetTableId;
  const rollupTargetTable = (tables ?? []).find((t) => t.id === rollupTargetTableId);

  const canSubmit = name.trim()
    && (!isRelation || targetTableId)
    && (!isRollup || rollupRelationColId)
    && (!isFormula || formulaExpression.trim());

  const handleSubmit = () => {
    if (!canSubmit) return;
    let config: Record<string, unknown> | undefined;

    if (isRelation) {
      config = { targetTableId, reciprocal };
    } else if (isRollup) {
      config = { relationColumnId: rollupRelationColId, sourceColumnId: rollupSourceColId, aggregation: rollupAggregation };
    } else if (isFormula) {
      config = { expression: formulaExpression.trim() };
    }

    onAdd(name.trim(), type, config);
    setName("");
    setType("text");
    setTargetTableId("");
    setRollupRelationColId("");
    setRollupSourceColId("");
    setFormulaExpression("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[120px]">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative z-10 w-72 rounded-lg border border-border bg-popover p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Add Column</h3>
          <button onClick={onClose} className="flex size-5 items-center justify-center rounded hover:bg-accent">
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="Column name"
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
            {COLUMN_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  type === t.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <ColumnTypeIcon type={t.value} className="size-3" />
                {t.label}
              </button>
            ))}
          </div>

          {isRelation && <RelationConfig
            availableTables={availableTables}
            targetTableId={targetTableId}
            reciprocal={reciprocal}
            onTargetChange={setTargetTableId}
            onReciprocalChange={setReciprocal}
          />}

          {isRollup && <RollupConfigUI
            relationColumns={relationColumns}
            rollupRelationColId={rollupRelationColId}
            rollupSourceColId={rollupSourceColId}
            rollupAggregation={rollupAggregation}
            targetTable={rollupTargetTable}
            onRelationChange={setRollupRelationColId}
            onSourceChange={setRollupSourceColId}
            onAggregationChange={setRollupAggregation}
          />}

          {isFormula && (
            <div className="space-y-1.5">
              <label className="text-3xs font-medium text-muted-foreground">Formula expression</label>
              <input
                value={formulaExpression}
                onChange={(e) => setFormulaExpression(e.target.value)}
                placeholder='e.g. prop("Price") * prop("Qty")'
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-3xs text-muted-foreground">
                Use prop("Column Name") to reference columns
              </p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Add Column
          </button>
        </div>
      </div>
    </div>
  );
}
