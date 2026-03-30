import { AlertTriangle, Bot, Sparkles, ChevronDown, ChevronUp, Check, X, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertGroup } from "./alert-group";
import type { DashboardItem, AutopilotProposal, Visualization } from "@openhelm/shared";

const DEFAULT_VISIBLE_GROUPS = 3;

interface DashboardAlertsSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  proposals: AutopilotProposal[];
  suggestedVizs: Visualization[];
  alertGroups: { jobId: string; items: DashboardItem[] }[];
  goals: { id: string; name: string }[];
  loading: boolean;
  dismissingAll: boolean;
  showAllAlerts: boolean;
  alertCount: number;
  onApproveProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
  onAcceptViz: (id: string) => void;
  onDismissViz: (id: string) => void;
  onDismissAll: () => void;
  onToggleShowAll: () => void;
}

export function DashboardAlertsSection({
  collapsed, onToggle,
  proposals, suggestedVizs, alertGroups, goals, loading, dismissingAll, showAllAlerts, alertCount,
  onApproveProposal, onRejectProposal, onAcceptViz, onDismissViz, onDismissAll, onToggleShowAll,
}: DashboardAlertsSectionProps) {
  const visibleGroups = showAllAlerts ? alertGroups : alertGroups.slice(0, DEFAULT_VISIBLE_GROUPS);
  const hiddenGroupCount = alertGroups.length - DEFAULT_VISIBLE_GROUPS;
  const itemCount = alertGroups.reduce((sum, g) => sum + g.items.length, 0);
  const firstProposal = proposals[0];
  const firstViz = suggestedVizs[0];
  const firstGroup = alertGroups[0];

  return (
    <section>
      <SectionHeader icon={AlertTriangle} title="Alerts & Actions"
        iconColor={alertCount > 0 ? "text-destructive" : undefined}
        badge={alertCount > 0 ? alertCount : undefined} collapsed={collapsed} onToggle={onToggle} />

      {collapsed ? (
        <div className="px-6 py-3 animate-in fade-in duration-200">
          {firstProposal ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{goals.find((g) => g.id === firstProposal.goalId)?.name ?? "Proposed system job"}</p>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{firstProposal.reason}</p>
            </div>
          ) : firstViz ? (
            <div className="rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5 p-3">
              <p className="text-sm font-medium">{firstViz.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">Suggested {firstViz.chartType} chart</p>
            </div>
          ) : firstGroup ? (
            <AlertGroup jobId={firstGroup.jobId} items={firstGroup.items.slice(0, 1)} />
          ) : (
            <p className="text-sm text-muted-foreground">All clear — no pending alerts.</p>
          )}
        </div>
      ) : (
        <div className="space-y-6 px-6 pt-3 pb-1 animate-in fade-in slide-in-from-top-1 duration-300">
          {proposals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <h4 className="text-xs font-semibold text-muted-foreground">Proposed System Jobs</h4>
                <Badge className="ml-1 text-[10px]">{proposals.length}</Badge>
              </div>
              {proposals.map((p) => {
                const goal = goals.find((g) => g.id === p.goalId);
                return (
                  <div key={p.id} className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium">{goal?.name ?? "Unknown Goal"}</p>
                    <ul className="mb-3 space-y-1">
                      {p.plannedJobs.map((sj, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Bot className="size-3 shrink-0" /> {sj.name}
                          <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{sj.systemCategory}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mb-3 text-xs text-muted-foreground">{p.reason}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="default" className="h-7 gap-1 text-xs" onClick={() => onApproveProposal(p.id)}>
                        <Check className="size-3" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onRejectProposal(p.id)}>
                        <X className="size-3" /> Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {suggestedVizs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-500" />
                <h4 className="text-xs font-semibold text-muted-foreground">Suggested Charts</h4>
                <Badge variant="outline" className="ml-1 text-[10px] border-blue-500/40 text-blue-500">{suggestedVizs.length}</Badge>
              </div>
              {suggestedVizs.map((viz) => (
                <div key={viz.id} className="rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{viz.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{viz.chartType}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-emerald-500" onClick={() => onAcceptViz(viz.id)}>
                        <Check className="size-3" /> Accept
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onDismissViz(viz.id)}>
                        <X className="size-3" /> Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className={cn("size-4", itemCount > 0 ? "text-destructive" : "text-muted-foreground/50")} />
              <h4 className="text-xs font-semibold text-muted-foreground">Needs Attention</h4>
              {itemCount > 0 && <Badge variant="destructive" className="ml-1 text-[10px]">{itemCount}</Badge>}
              {itemCount > 0 && (
                <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  disabled={dismissingAll || loading} onClick={onDismissAll}>Dismiss all</Button>
              )}
            </div>
            {alertGroups.length > 0 ? (
              <div className="space-y-3">
                {visibleGroups.map((g) => <AlertGroup key={g.jobId} jobId={g.jobId} items={g.items} />)}
                {alertGroups.length > DEFAULT_VISIBLE_GROUPS && (
                  <button className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={onToggleShowAll}>
                    {showAllAlerts ? <><ChevronUp className="size-3.5" /> Show less</> : <><ChevronDown className="size-3.5" /> {hiddenGroupCount} more</>}
                  </button>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No alerts — everything looks good.</p>
            )}
          </div>

          {alertCount === 0 && (
            <div className="py-6 text-center">
              <LayoutDashboard className="mx-auto mb-3 size-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">All clear — no alerts or pending actions.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SectionHeader({ icon: Icon, title, iconColor, badge, collapsed, onToggle }: {
  icon: React.ElementType; title: string; iconColor?: string; badge?: number;
  collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-background flex items-center gap-2.5 border-b border-border px-6 py-3">
      <Icon className={cn("size-5", iconColor ?? "text-muted-foreground")} />
      <h3 className="flex-1 text-base font-semibold">{title}</h3>
      {badge !== undefined && badge > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1.5 py-0 text-[10px]">{badge}</Badge>
      )}
      <button onClick={onToggle} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        {collapsed ? "View more" : "View less"}
        {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
      </button>
    </div>
  );
}
