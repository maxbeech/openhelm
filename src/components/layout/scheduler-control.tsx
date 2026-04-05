import { useState } from "react";
import { Pause, Play, Square, Zap, ZapOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSchedulerStatus } from "@/hooks/use-scheduler-status";
import { useLowTokenModeStore } from "@/stores/low-token-mode-store";
import { useAgentEvent } from "@/hooks/use-agent-event";

export function SchedulerControl() {
  const { status, pause, resume, stopAll, loading } = useSchedulerStatus();
  const { enabled: lowTokenMode, setEnabled: setLowTokenMode, loading: ltmLoading, load: loadLtm } = useLowTokenModeStore();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Refresh low token mode state when the agent emits scheduler.statusChanged
  // (e.g. after the weekly auto-reset fires in the agent's tick)
  useAgentEvent("scheduler.statusChanged", () => { void loadLtm(); });

  if (loading || !status) return null;

  const isPaused = status.paused;
  const hasActiveWork = status.activeRuns > 0 || status.queuedRuns > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
            <span
              className={`inline-block size-2 rounded-full ${
                isPaused ? "bg-amber-500" : "bg-emerald-500"
              }`}
            />
            {isPaused ? "Paused" : "Running"}
            {lowTokenMode && <Zap className="size-3 text-amber-500" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isPaused ? (
            <DropdownMenuItem onClick={() => void resume()}>
              <Play className="mr-2 size-3.5" />
              Resume scheduling
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => void pause()}>
              <Pause className="mr-2 size-3.5" />
              Pause scheduling
            </DropdownMenuItem>
          )}
          {hasActiveWork && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Square className="mr-2 size-3.5" />
                Stop all tasks
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {!ltmLoading && (
            <DropdownMenuItem onClick={() => void setLowTokenMode(!lowTokenMode)}>
              {lowTokenMode ? (
                <>
                  <ZapOff className="mr-2 size-3.5" />
                  Disable low token mode
                </>
              ) : (
                <>
                  <Zap className="mr-2 size-3.5" />
                  Enable low token mode
                </>
              )}
            </DropdownMenuItem>
          )}
          {lowTokenMode && (
            <div className="px-2 py-1 text-2xs text-amber-600 dark:text-amber-400">
              Using Haiku · ⅓ less frequent
            </div>
          )}
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {status.activeRuns} active, {status.queuedRuns} queued
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel {status.activeRuns > 0 && `${status.activeRuns} running`}
              {status.activeRuns > 0 && status.queuedRuns > 0 && " and "}
              {status.queuedRuns > 0 && `${status.queuedRuns} queued`}
              {" "}task{(status.activeRuns + status.queuedRuns) !== 1 ? "s" : ""}.
              Running Claude Code processes will be terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void stopAll()}
            >
              Stop all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
