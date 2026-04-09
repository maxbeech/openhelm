import { useState } from "react";
import { PauseCircle, X, Zap } from "lucide-react";
import { usePausedRunToastStore } from "@/stores/paused-run-toast-store";
import { useJobStore } from "@/stores/job-store";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Bottom-left toast shown when the user triggers a job while the scheduler is
 * paused. Offers "Run Now Anyway" to force-execute the queued run without
 * unpausing OpenHelm, or dismiss to leave it queued.
 */
export function PausedRunToast() {
  const { pending, dismissToast } = usePausedRunToastStore();
  const { jobs } = useJobStore();
  const [forcing, setForcing] = useState(false);

  if (!pending) return null;

  const job = jobs.find((j) => j.id === pending.jobId);
  const jobName = job?.name ?? "this job";

  const handleRunNowAnyway = async () => {
    setForcing(true);
    try {
      await api.forceRunNow(pending.runId);
    } catch (err) {
      console.error("[PausedRunToast] forceRunNow error:", err);
    } finally {
      setForcing(false);
      dismissToast();
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 animate-in slide-in-from-bottom-2 fade-in duration-200">
      <div className="rounded-lg border border-amber-500/30 bg-card shadow-lg">
        <div className="flex items-start gap-3 p-3">
          <PauseCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">OpenHelm is paused</p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">{jobName}</span> will run when unpaused.
            </p>
          </div>
          <button
            onClick={dismissToast}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className={cn("border-t border-border/50 px-3 pb-3 pt-2")}>
          <button
            onClick={handleRunNowAnyway}
            disabled={forcing}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Zap className="size-3" />
            {forcing ? "Starting…" : "Run now anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
