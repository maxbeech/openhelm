import { RotateCcw, Play, CalendarClock } from "lucide-react";
import type { Run } from "@openorchestra/shared";

interface RunTriggerInfoProps {
  run: Run;
  jobName: string;
  onSelectJob: (jobId: string) => void;
  onSelectRun: (runId: string) => void;
}

export function RunTriggerInfo({
  run,
  jobName,
  onSelectJob,
  onSelectRun,
}: RunTriggerInfoProps) {
  const isCorrective = run.triggerSource === "corrective";
  const isManual = run.triggerSource === "manual";

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs flex-wrap">
      {isCorrective ? (
        <>
          <RotateCcw className="size-3.5 text-amber-400 shrink-0" />
          <span className="text-muted-foreground">Auto-retry of</span>
          {run.parentRunId ? (
            <button
              onClick={() => onSelectRun(run.parentRunId!)}
              className="text-foreground hover:underline"
            >
              run {run.parentRunId.slice(0, 8)}
            </button>
          ) : (
            <span className="text-muted-foreground">a previous run</span>
          )}
        </>
      ) : isManual ? (
        <>
          <Play className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Manually triggered</span>
        </>
      ) : (
        <>
          <CalendarClock className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Triggered by schedule</span>
        </>
      )}
      <span className="text-muted-foreground/50">·</span>
      <button
        onClick={() => onSelectJob(run.jobId)}
        className="text-foreground hover:underline truncate"
      >
        {jobName}
      </button>
    </div>
  );
}
