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
import { Label } from "@/components/ui/label";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { useJobStore } from "@/stores/job-store";
import { useGoalStore } from "@/stores/goal-store";
import { JobCreationForm, type JobFormState, type JobFormErrors } from "./job-creation-form";
import { setCredentialScopesForEntity } from "@/lib/api";
import type { Job, ScheduleConfig, ScheduleConfigCalendar } from "@openhelm/shared";

interface JobEditSheetProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectDirectory: string;
  onComplete: () => void;
}

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
  if (form.scheduleType === "manual") return {};
  // "once" — fire 10 seconds from now
  return { fireAt: new Date(Date.now() + 10_000).toISOString() };
}

function jobToFormState(job: Job): JobFormState {
  let intervalAmount = 1;
  let intervalUnit: "minutes" | "hours" | "days" = "hours";
  let calendarFrequency: "daily" | "weekly" | "monthly" = "daily";
  let calendarTime = "09:00";
  let calendarDayOfWeek = 1;
  let calendarDaysOfWeek: number[] = [1];
  let calendarDayOfMonth = 1;

  if (job.scheduleType === "interval") {
    const cfg = job.scheduleConfig as Record<string, unknown>;
    if (typeof cfg.amount === "number") {
      intervalAmount = cfg.amount;
      intervalUnit = (cfg.unit as "minutes" | "hours" | "days") ?? "hours";
    } else if (typeof cfg.minutes === "number") {
      // Legacy format: { minutes: N }
      intervalAmount = cfg.minutes;
      intervalUnit = "minutes";
    }
  }

  if (job.scheduleType === "calendar") {
    const cfg = job.scheduleConfig as ScheduleConfigCalendar;
    calendarFrequency = cfg.frequency ?? "daily";
    calendarTime = cfg.time ?? "09:00";
    calendarDaysOfWeek =
      cfg.daysOfWeek && cfg.daysOfWeek.length > 0
        ? cfg.daysOfWeek
        : cfg.dayOfWeek != null
          ? [cfg.dayOfWeek]
          : [1];
    calendarDayOfWeek = calendarDaysOfWeek[0];
    calendarDayOfMonth = cfg.dayOfMonth ?? 1;
  }

  return {
    name: job.name,
    prompt: job.prompt,
    goalId: job.goalId ?? "none",
    scheduleType: job.scheduleType,
    intervalAmount,
    intervalUnit,
    calendarFrequency,
    calendarTime,
    calendarDayOfWeek,
    calendarDaysOfWeek,
    calendarDayOfMonth,
    model: job.model ?? "sonnet",
    modelEffort: job.modelEffort ?? "medium",
    permissionMode: job.permissionMode ?? "bypassPermissions",
    workingDirectory: job.workingDirectory ?? "",
    correctionNote: job.correctionNote ?? "",
    silenceTimeoutMinutes: job.silenceTimeoutMinutes != null
      ? String(job.silenceTimeoutMinutes)
      : "",
    credentialIds: [], // Populated on mount via CredentialMultiPicker existingScope
  };
}

export function JobEditSheet({
  job,
  open,
  onOpenChange,
  projectDirectory,
  onComplete,
}: JobEditSheetProps) {
  const { updateJob } = useJobStore();
  const { goals } = useGoalStore();

  const [form, setForm] = useState<JobFormState>(() => jobToFormState(job));
  const [icon, setIcon] = useState<string | null>(job.icon);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(jobToFormState(job));
      setIcon(job.icon);
      setTouched({});
      setError(null);
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    setForm(jobToFormState(job));
    setTouched({});
    setSaving(false);
    setError(null);
  }, [job]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) handleReset();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    setTouched({ name: true, prompt: true });
    if (!isValid) return;

    setSaving(true);
    setError(null);
    try {
      await updateJob({
        id: job.id,
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        goalId: form.goalId !== "none" ? form.goalId : null,
        scheduleType: form.scheduleType,
        scheduleConfig: getScheduleConfig(form),
        workingDirectory: form.workingDirectory.trim() || undefined,
        model: form.model,
        modelEffort: form.modelEffort,
        permissionMode: form.permissionMode,
        correctionNote: form.correctionNote.trim() || null,
        silenceTimeoutMinutes: form.silenceTimeoutMinutes
          ? parseInt(form.silenceTimeoutMinutes, 10) || null
          : null,
        ...(icon !== job.icon && { icon: icon ?? undefined }),
      });
      await setCredentialScopesForEntity({ scopeType: "job", scopeId: job.id, credentialIds: form.credentialIds });
      handleOpenChange(false);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <EmojiPicker
              value={icon}
              onChange={setIcon}
              variant="job"
            />
            <div>
              <SheetTitle>Edit Job</SheetTitle>
              <SheetDescription>
                Update the job configuration.
              </SheetDescription>
            </div>
          </div>
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
          isEditing
          existingJobId={job.id}
        />

        <div className="flex gap-2 border-t border-border p-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={saving || !isValid}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
