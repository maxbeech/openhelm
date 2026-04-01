import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useAppStore } from "@/stores/app-store";
import { InlineJobForm, EMPTY_INLINE_JOB, type InlineJob } from "./inline-job-form";
import { CredentialMultiPicker } from "@/components/credentials/credential-multi-picker";
import { setCredentialScopesForEntity } from "@/lib/api";
import type { ScheduleConfig } from "@openhelm/shared";

interface GoalCreationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  projectId: string;
  parentGoalId?: string;
  onComplete: () => void;
}

function jobScheduleConfig(job: InlineJob): ScheduleConfig {
  if (job.scheduleType === "interval") return { minutes: job.intervalMinutes };
  if (job.scheduleType === "cron") return { expression: job.cronExpression };
  return { fireAt: new Date(Date.now() + 10_000).toISOString() };
}

export function GoalCreationSheet({
  open,
  onOpenChange,
  initialName = "",
  projectId,
  parentGoalId,
  onComplete,
}: GoalCreationSheetProps) {
  const { createGoal } = useGoalStore();
  const { createJob } = useJobStore();
  const { activeProjectId } = useAppStore();
  const projectDirectory = ""; // Will default in InlineJobForm placeholder

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [inlineJobs, setInlineJobs] = useState<InlineJob[]>([]);
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const [jobsTouched, setJobsTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription("");
      setInlineJobs([]);
      setCredentialIds([]);
      setNameTouched(false);
      setJobsTouched(false);
      setError(null);
      setCreating(false);
    }
  }, [open, initialName]);

  const jobsValid = inlineJobs.every((j) => j.name.trim() && j.prompt.trim());
  const isValid = name.trim() && jobsValid;

  const handleSubmit = async () => {
    setNameTouched(true);
    setJobsTouched(true);
    if (!isValid) return;

    setCreating(true);
    setError(null);
    try {
      const goal = await createGoal({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        parentId: parentGoalId,
      });
      if (credentialIds.length > 0) {
        await setCredentialScopesForEntity({ scopeType: "goal", scopeId: goal.id, credentialIds });
      }
      for (const j of inlineJobs) {
        if (j.name.trim() && j.prompt.trim()) {
          await createJob({
            projectId,
            goalId: goal.id,
            name: j.name.trim(),
            prompt: j.prompt.trim(),
            scheduleType: j.scheduleType,
            scheduleConfig: jobScheduleConfig(j),
            workingDirectory: j.workingDirectory.trim() || undefined,
          });
        }
      }
      onOpenChange(false);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goal");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{parentGoalId ? "Create a Sub-Goal" : "Create a Goal"}</SheetTitle>
          <SheetDescription className="sr-only">
            Create a new goal and optionally add jobs to run on a schedule.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              placeholder="e.g. Improve test coverage"
              className="h-9"
              autoFocus
            />
            {nameTouched && !name.trim() && (
              <p className="text-xs text-destructive">Name is required</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-description">Description (optional)</Label>
            <Textarea
              id="goal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context about what you want to achieve..."
              rows={3}
              className="text-sm"
            />
          </div>

          {/* Credentials */}
          <div className="space-y-1.5">
            <Label>Credentials (optional)</Label>
            <CredentialMultiPicker value={credentialIds} onChange={setCredentialIds} />
          </div>

          {/* Inline Jobs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Jobs (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setInlineJobs((j) => [...j, { ...EMPTY_INLINE_JOB }])}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="size-3.5" />
                Add job
              </Button>
            </div>
            {inlineJobs.map((job, i) => (
              <InlineJobForm
                key={i}
                job={job}
                index={i}
                projectDirectory={projectDirectory}
                touched={jobsTouched}
                onChange={(updated) =>
                  setInlineJobs((jobs) =>
                    jobs.map((j, idx) => (idx === i ? updated : j))
                  )
                }
                onRemove={() =>
                  setInlineJobs((jobs) => jobs.filter((_, idx) => idx !== i))
                }
              />
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={creating}
          >
            {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
