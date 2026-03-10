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
import type { Goal, ScheduleType } from "@openorchestra/shared";

export interface JobFormState {
  name: string;
  prompt: string;
  goalId: string;
  scheduleType: ScheduleType;
  intervalMinutes: number;
  cronExpression: string;
  workingDirectory: string;
}

export interface JobFormErrors {
  name: string | null;
  prompt: string | null;
  interval: string | null;
}

interface JobCreationFormProps {
  form: JobFormState;
  errors: JobFormErrors;
  goals: Goal[];
  projectDirectory: string;
  onFieldChange: (field: keyof JobFormState, value: string | number) => void;
  onFieldBlur: (field: string) => void;
  error: string | null;
}

export function JobCreationForm({
  form,
  errors,
  goals,
  projectDirectory,
  onFieldChange,
  onFieldBlur,
  error,
}: JobCreationFormProps) {
  return (
    <div className="flex-1 space-y-4 overflow-auto p-4">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="job-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="job-name"
          value={form.name}
          onChange={(e) => onFieldChange("name", e.target.value)}
          onBlur={() => onFieldBlur("name")}
          placeholder="e.g. Run test suite"
          className="h-9"
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name}</p>
        )}
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="job-prompt">
            Prompt <span className="text-destructive">*</span>
          </Label>
          <span className="text-xs text-muted-foreground">
            {form.prompt.length} chars
          </span>
        </div>
        <Textarea
          id="job-prompt"
          value={form.prompt}
          onChange={(e) => onFieldChange("prompt", e.target.value)}
          onBlur={() => onFieldBlur("prompt")}
          placeholder="Sent directly to Claude Code. Include context about your project and be specific."
          rows={5}
          className="text-sm"
        />
        {errors.prompt && (
          <p className="text-xs text-destructive">{errors.prompt}</p>
        )}
      </div>

      {/* Goal association */}
      <div className="space-y-1.5">
        <Label>Goal (optional)</Label>
        <Select
          value={form.goalId}
          onValueChange={(v) => onFieldChange("goalId", v)}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="No goal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No goal</SelectItem>
            {goals.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {(g.name || g.description).slice(0, 40)}
                {(g.name || g.description).length > 40 ? "..." : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule */}
      <div className="space-y-1.5">
        <Label>Schedule</Label>
        <Select
          value={form.scheduleType}
          onValueChange={(v) => onFieldChange("scheduleType", v)}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">Once (immediately)</SelectItem>
            <SelectItem value="interval">Interval</SelectItem>
            <SelectItem value="cron">Cron</SelectItem>
          </SelectContent>
        </Select>
        {form.scheduleType === "interval" && (
          <div className="space-y-1">
            <Input
              type="number"
              value={form.intervalMinutes}
              onChange={(e) =>
                onFieldChange("intervalMinutes", Number(e.target.value))
              }
              min={1}
              className="mt-1.5 h-9 text-sm"
              placeholder="Minutes between runs"
            />
            {errors.interval && (
              <p className="text-xs text-destructive">{errors.interval}</p>
            )}
          </div>
        )}
        {form.scheduleType === "cron" && (
          <Input
            value={form.cronExpression}
            onChange={(e) => onFieldChange("cronExpression", e.target.value)}
            className="mt-1.5 h-9 text-sm"
            placeholder="0 9 * * 1 (Mon 9am)"
          />
        )}
      </div>

      {/* Working directory */}
      <div className="space-y-1.5">
        <Label htmlFor="job-workdir">Working directory</Label>
        <Input
          id="job-workdir"
          value={form.workingDirectory}
          onChange={(e) => onFieldChange("workingDirectory", e.target.value)}
          placeholder={projectDirectory}
          className="h-9 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Defaults to the project directory. Override for a subdirectory.
        </p>
      </div>

      {/* Error */}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
