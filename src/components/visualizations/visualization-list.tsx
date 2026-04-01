import { useEffect, useState, useCallback } from "react";
import { BarChart3, Plus, Trash2, Check, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChartRenderer } from "./chart-renderer";
import { ChartCreateDialog } from "./chart-create-dialog";
import { useVisualizationStore } from "@/stores/visualization-store";
import { useAgentEvent } from "@/hooks/use-agent-event";
import type { Visualization } from "@openhelm/shared";

interface Props {
  projectId: string;
  goalId?: string;
  jobId?: string;
  compact?: boolean;
}

export function VisualizationList({ projectId, goalId, jobId, compact }: Props) {
  const { visualizations, fetchVisualizations, deleteVisualization, acceptVisualization, dismissVisualization } =
    useVisualizationStore();
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(() => {
    fetchVisualizations({ projectId, goalId, jobId });
  }, [projectId, goalId, jobId, fetchVisualizations]);

  useEffect(() => { loadData(); }, [loadData]);

  useAgentEvent("visualization.created", loadData);
  useAgentEvent("visualization.updated", loadData);
  useAgentEvent("visualization.deleted", loadData);
  useAgentEvent("dataTable.rowsChanged", loadData);

  const active = visualizations.filter((v) => v.status === "active");
  const suggested = visualizations.filter((v) => v.status === "suggested");

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await deleteVisualization(id);
    setDeletingId(null);
  };

  if (active.length === 0 && suggested.length === 0 && !showCreate) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-muted-foreground">Charts</h4>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        <div className="text-xs text-muted-foreground py-4 text-center">
          No charts yet
        </div>
        {showCreate && (
          <ChartCreateDialog
            projectId={projectId}
            goalId={goalId}
            jobId={jobId}
            onClose={() => setShowCreate(false)}
            onCreated={loadData}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" /> Charts ({active.length})
        </h4>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>

      {suggested.length > 0 && (
        <div className="space-y-2 mb-3">
          {suggested.map((viz) => (
            <SuggestedCard
              key={viz.id}
              viz={viz}
              compact={compact}
              onAccept={() => acceptVisualization(viz.id)}
              onDismiss={() => dismissVisualization(viz.id)}
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {active.map((viz) => (
          <div key={viz.id} className="rounded-lg border bg-card">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{viz.name}</span>
                <Badge variant="outline" className="text-3xs px-1.5 py-0">
                  {viz.chartType}
                </Badge>
                {viz.source === "system" && (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0">auto</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(viz.id)}
                disabled={deletingId === viz.id}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <ChartRenderer visualization={viz} compact={compact} />
          </div>
        ))}
      </div>

      {showCreate && (
        <ChartCreateDialog
          projectId={projectId}
          goalId={goalId}
          jobId={jobId}
          onClose={() => setShowCreate(false)}
          onCreated={loadData}
        />
      )}
    </div>
  );
}

function SuggestedCard({
  viz,
  compact,
  onAccept,
  onDismiss,
}: {
  viz: Visualization;
  compact?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5">
      <div className="flex items-center justify-between px-3 py-2 border-b border-blue-500/20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-blue-500" />
          <span className="text-xs font-medium">{viz.name}</span>
          <Badge variant="outline" className="text-3xs px-1.5 py-0 border-blue-500/40 text-blue-500">
            suggested
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-emerald-500" onClick={onAccept}>
            <Check className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ChartRenderer visualization={viz} compact={compact} />
    </div>
  );
}
