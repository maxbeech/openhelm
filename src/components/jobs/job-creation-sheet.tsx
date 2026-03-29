import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/stores/job-store";
import { useGoalStore } from "@/stores/goal-store";
import { JobCreationForm, type JobFormState, type JobFormErrors } from "./job-creation-form";
import { setCredentialScopesForEntity } from "@/lib/api";
import type { ScheduleConfig } from "@openhelm/shared";

interface JobCreationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectDirectory: string;
  onComplete: () => void;
  initialName?: string;
  initialGoalId?: string;
}

const INITIAL_FORM: JobFormState = {
  name: "",
  prompt: "",
  goalId: "none",
  scheduleType: "once",
  intervalAmount: 1,
  intervalUnit: "hours",
  calendarFrequency: "daily",
  calendarTime: "09:00",
  calendarDayOfWeek: 1,
  calendarDaysOfWeek: [1],
  calendarDayOfMonth: 1,
  model: "sonnet",
  modelEffort: "medium",
  permissionMode: "bypassPermissions",
  workingDirectory: "",
  correctionNote: "",
  silenceTimeoutMinutes: "",
  credentialIds: [],
};

function getScheduleConfig(form: JobFormState): ScheduleConfig {
  if (form.scheduleType === "interval") {
    return { amount: form.intervalAmount, unit: form.intervalUnit };
  }
  if (form.scheduleType === "calendar") {
    return {
      frequency: form.calendarFrequency,
      time: form.calendarTime,
      ...(form.calendarFrequency === "weekly"
        ? { daysOfWeek: form.calendarDaysOfWeek }
        : { dayOfMonth: form.calendarDayOfMonth }),
    };
  }
  if (form.scheduleType === "cron") {
    return { expression: form.cronExpression ?? "" };
  }
  if (form.scheduleType === "manual") {
    return {};
  }
  // "once" — fire 10 seconds from now
  return { fireAt: new Date(Date.now() + 10_000).toISOString() };
}

export function JobCreationSheet({
  open,
  onOpenChange,
  projectId,
  projectDirectory,
  onComplete,
  initialName,
  initialGoalId,
}: JobCreationSheetProps) {
  const { createJob } = useJobStore();
  const { goals } = useGoalStore();

  const [form, setForm] = useState<JobFormState>(INITIAL_FORM);

  // Re-initialise form whenever the sheet opens (or initial values change)
  useEffect(() => {
    if (open) {
      setForm({ ...INITIAL_FORM, name: initialName ?? "", goalId: initialGoalId ?? "none" });
      setTouched({});
      setError(null);
      setCreating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === "active"),
    [goals],
  );

  const errors: JobFormErrors = {
    name: touched.name && !form.name.trim() ? "Name is required" : null,
    prompt: touched.prompt && !form.prompt.trim() ? "Prompt is required" : null,
    interval:
      form.scheduleType === "interval" && form.intervalAmount < 1
        ? "Interval must be at least 1"
        : null,
    calendar:
      form.scheduleType === "calendar" && !form.calendarTime
        ? "Time is required"
        : null,
  };
  const isValid =
    form.name.trim() &&
    form.prompt.trim() &&
    !errors.interval &&
    !errors.calendar;

  const handleReset = useCallback(() => {
    setForm(INITIAL_FORM);
    setTouched({});
    setCreating(false);
    setError(null);
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) handleReset();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    setTouched({ name: true, prompt: true });
    if (!isValid) return;

    setCreating(true);
    setError(null);
    try {
      const job = await createJob({
        projectId,
        goalId: form.goalId !== "none" ? form.goalId : undefined,
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        scheduleType: form.scheduleType,
        scheduleConfig: getScheduleConfig(form),
        workingDirectory: form.workingDirectory.trim() || undefined,
        model: form.model,
        modelEffort: form.modelEffort,
        permissionMode: form.permissionMode,
        silenceTimeoutMinutes: form.silenceTimeoutMinutes
          ? parseInt(form.silenceTimeoutMinutes, 10) || null
          : null,
      });
      if (form.credentialIds.length > 0) {
        await setCredentialScopesForEntity({ scopeType: "job", scopeId: job.id, credentialIds: form.credentialIds });
      }
      handleOpenChange(false);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Create a Job</SheetTitle>
          <SheetDescription>
            Define a task for Claude Code to run.
          </SheetDescription>
        </SheetHeader>

        <JobCreationForm
          form={form}
          errors={errors}
          goals={activeGoals}
          projectDirectory={projectDirectory}
          onFieldChange={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
          onFieldBlur={(f) => setTouched((t) => ({ ...t, [f]: true }))}
          onCredentialsChange={(ids) => setForm((f) => ({ ...f, credentialIds: ids }))}
          error={error}
        />

        <div className="flex gap-2 border-t border-border p-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handleOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={creating || !isValid}>
            {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
            {creating ? "Creating..." : "Create Job"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
