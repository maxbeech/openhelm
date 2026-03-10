import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useJobStore } from "@/stores/job-store";
import { useGoalStore } from "@/stores/goal-store";
import { JobCreationForm, type JobFormState, type JobFormErrors } from "./job-creation-form";
import type { ScheduleConfig } from "@openorchestra/shared";

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
  intervalMinutes: 60,
  cronExpression: "0 9 * * 1",
  workingDirectory: "",
};

function getScheduleConfig(form: JobFormState): ScheduleConfig {
  if (form.scheduleType === "interval") return { minutes: form.intervalMinutes };
  if (form.scheduleType === "cron") return { expression: form.cronExpression };
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
      form.scheduleType === "interval" && form.intervalMinutes < 1
        ? "Interval must be at least 1 minute"
        : null,
  };
  const isValid = form.name.trim() && form.prompt.trim() && !errors.interval;

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
      await createJob({
        projectId,
        goalId: form.goalId !== "none" ? form.goalId : undefined,
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        scheduleType: form.scheduleType,
        scheduleConfig: getScheduleConfig(form),
        workingDirectory: form.workingDirectory.trim() || undefined,
      });
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
          <p className="text-sm text-muted-foreground">
            Define a task for Claude Code to run.
          </p>
        </SheetHeader>

        <JobCreationForm
          form={form}
          errors={errors}
          goals={activeGoals}
          projectDirectory={projectDirectory}
          onFieldChange={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
          onFieldBlur={(f) => setTouched((t) => ({ ...t, [f]: true }))}
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
