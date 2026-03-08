import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import * as api from "@/lib/api";
import { ErrorBanner } from "@/components/shared/error-banner";
import type { GeneratedPlan, PlannedJob, ScheduleType } from "@openorchestra/shared";
import { formatSchedule } from "@/lib/format";

interface PlanReviewStepProps {
  plan: GeneratedPlan;
  projectId: string;
  goalText: string;
  onJobUpdate: (index: number, job: PlannedJob) => void;
  onJobDelete: (index: number) => void;
  onJobAdd: (job: PlannedJob) => void;
  onCommit: (result: { goalId: string; jobIds: string[] }) => void;
}

export function PlanReviewStep({
  plan,
  projectId,
  goalText,
  onJobUpdate,
  onJobDelete,
  onJobAdd,
  onCommit,
}: PlanReviewStepProps) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const onceCount = plan.jobs.filter((j) => j.scheduleType === "once").length;
  const scheduledCount = plan.jobs.length - onceCount;

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const result = await api.commitPlan({
        projectId,
        goalDescription: goalText,
        jobs: plan.jobs,
      });
      onCommit(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit plan");
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <div className="rounded-lg bg-primary/10 p-3 text-sm">
        This plan will create{" "}
        <strong>
          {plan.jobs.length} {plan.jobs.length === 1 ? "job" : "jobs"}
        </strong>
        {onceCount > 0 && (
          <>
            {" "}
            &mdash; {onceCount} start{onceCount === 1 ? "s" : ""} immediately
          </>
        )}
        {scheduledCount > 0 && (
          <>
            , {scheduledCount} run{scheduledCount === 1 ? "s" : ""} on a
            schedule
          </>
        )}
        .
      </div>

      {/* Job Cards */}
      {plan.jobs.map((job, i) =>
        editingIndex === i ? (
          <JobEditCard
            key={i}
            job={job}
            onSave={(updated) => {
              onJobUpdate(i, updated);
              setEditingIndex(null);
            }}
            onCancel={() => setEditingIndex(null)}
          />
        ) : (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between">
              <h4 className="font-medium">{job.name}</h4>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditingIndex(i)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => onJobDelete(i)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {job.description}
            </p>
            <p className="mt-2 text-xs text-primary">
              {formatSchedule(job.scheduleType, job.scheduleConfig)}
            </p>
            {job.rationale && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                {job.rationale}
              </p>
            )}
          </div>
        ),
      )}

      {/* Add Job */}
      {showAddForm ? (
        <JobEditCard
          job={{
            name: "",
            description: "",
            prompt: "",
            rationale: "",
            scheduleType: "once",
            scheduleConfig: { fireAt: new Date().toISOString() },
          }}
          onSave={(job) => {
            onJobAdd(job);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add another job
        </button>
      )}

      {error && (
        <ErrorBanner
          message={error}
          onRetry={handleCommit}
          onDismiss={() => setError(null)}
        />
      )}

      <Button
        onClick={handleCommit}
        disabled={plan.jobs.length === 0 || committing}
        className="w-full"
      >
        {committing ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Approving...
          </>
        ) : (
          "Approve and start"
        )}
      </Button>
    </div>
  );
}

function JobEditCard({
  job,
  onSave,
  onCancel,
}: {
  job: PlannedJob;
  onSave: (job: PlannedJob) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(job.name);
  const [prompt, setPrompt] = useState(job.prompt);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    job.scheduleType,
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    job.scheduleType === "interval"
      ? (job.scheduleConfig as { minutes: number }).minutes
      : 60,
  );
  const [cronExpression, setCronExpression] = useState(
    job.scheduleType === "cron"
      ? (job.scheduleConfig as { expression: string }).expression
      : "0 9 * * 1",
  );

  const getScheduleConfig = () => {
    switch (scheduleType) {
      case "once":
        return { fireAt: new Date().toISOString() };
      case "interval":
        return { minutes: intervalMinutes };
      case "cron":
        return { expression: cronExpression };
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-card p-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Schedule</Label>
        <Select
          value={scheduleType}
          onValueChange={(v) => setScheduleType(v as ScheduleType)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">Once (immediately)</SelectItem>
            <SelectItem value="interval">Interval</SelectItem>
            <SelectItem value="cron">Cron</SelectItem>
          </SelectContent>
        </Select>
        {scheduleType === "interval" && (
          <Input
            type="number"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            min={1}
            className="mt-1 h-8 text-sm"
            placeholder="Minutes between runs"
          />
        )}
        {scheduleType === "cron" && (
          <Input
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            className="mt-1 h-8 text-sm"
            placeholder="0 9 * * 1"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-3.5" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              ...job,
              name,
              prompt,
              scheduleType,
              scheduleConfig: getScheduleConfig(),
            })
          }
          disabled={!name.trim() || !prompt.trim()}
        >
          <Check className="size-3.5" />
          Save
        </Button>
      </div>
    </div>
  );
}
