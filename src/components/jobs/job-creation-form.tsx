import { Info } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Goal, ScheduleType, PermissionMode } from "@openhelm/shared";
import { ScheduleConfigForm } from "./schedule-config-form";

export interface JobFormState {
  name: string;
  prompt: string;
  goalId: string;
  scheduleType: ScheduleType;
  // Interval
  intervalAmount: number;
  intervalUnit: "minutes" | "hours" | "days";
  // Calendar
  calendarFrequency: "daily" | "weekly" | "monthly";
  calendarTime: string;
  calendarDayOfWeek: number;
  calendarDaysOfWeek: number[];
  calendarDayOfMonth: number;
  // Model
  model: string;
  modelEffort: "low" | "medium" | "high";
  // Permissions
  permissionMode: PermissionMode;
  workingDirectory: string;
  // Correction note (AI-managed, only shown in edit mode)
  correctionNote: string;
  // Silence timeout override (in minutes; empty = use system default)
  silenceTimeoutMinutes: string;
  // Legacy cron (kept for existing jobs)
  cronExpression?: string;
}

export interface JobFormErrors {
  name: string | null;
  prompt: string | null;
  interval: string | null;
  calendar: string | null;
}

interface JobCreationFormProps {
  form: JobFormState;
  errors: JobFormErrors;
  goals: Goal[];
  projectDirectory: string;
  onFieldChange: (field: keyof JobFormState, value: string | number | number[]) => void;
  onFieldBlur: (field: string) => void;
  error: string | null;
  isEditing?: boolean;
}

export function JobCreationForm({
  form,
  errors,
  goals,
  projectDirectory,
  onFieldChange,
  onFieldBlur,
  error,
  isEditing,
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
            <SelectItem value="interval">Interval (repeating)</SelectItem>
            <SelectItem value="calendar">Calendar (scheduled)</SelectItem>
            <SelectItem value="manual">Manual only</SelectItem>
          </SelectContent>
        </Select>
        <ScheduleConfigForm
          form={form}
          intervalError={errors.interval}
          calendarError={errors.calendar}
          onFieldChange={onFieldChange}
        />
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

      {/* Model */}
      <div className="space-y-1.5">
        <Label>Model</Label>
        <Select
          value={form.model}
          onValueChange={(v) => onFieldChange("model", v)}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sonnet">Sonnet (recommended)</SelectItem>
            <SelectItem value="haiku">Haiku (faster)</SelectItem>
            <SelectItem value="opus">Opus (most capable)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Effort */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label>Effort</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                High effort enables extended thinking, giving Claude more time
                to reason through complex problems. Increases cost and runtime.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={form.modelEffort}
          onValueChange={(v) => onFieldChange("modelEffort", v)}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium (default)</SelectItem>
            <SelectItem value="high">High (extended thinking)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Permissions */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label>Permissions</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Controls what Claude Code is allowed to do without asking.
                bypassPermissions is recommended for automated background jobs.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={form.permissionMode}
          onValueChange={(v) => onFieldChange("permissionMode", v)}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bypassPermissions">Bypass permissions (recommended)</SelectItem>
            <SelectItem value="acceptEdits">Accept edits automatically</SelectItem>
            <SelectItem value="default">Default (prompt on first use)</SelectItem>
            <SelectItem value="dontAsk">Don't ask (deny unless pre-approved)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Silence timeout */}
      <div className="space-y-1.5">
        <Label htmlFor="job-silence-timeout">Silence timeout (minutes)</Label>
        <Input
          id="job-silence-timeout"
          type="number"
          min={1}
          value={form.silenceTimeoutMinutes}
          onChange={(e) => onFieldChange("silenceTimeoutMinutes", e.target.value)}
          placeholder="10 (default)"
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Time without output before a run is killed. Increase for jobs using slow browser or MCP tools.
        </p>
      </div>

      {/* Correction Note — only in edit mode when a note exists */}
      {isEditing && form.correctionNote && (
        <div className="space-y-1.5">
          <Label htmlFor="job-correction-note">Correction Note</Label>
          <Textarea
            id="job-correction-note"
            value={form.correctionNote}
            onChange={(e) => onFieldChange("correctionNote", e.target.value)}
            rows={3}
            className="text-sm border-amber-500/30"
          />
          <p className="text-xs text-muted-foreground">
            AI-generated from a previous failure. May be overridden by the AI after future runs.
          </p>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
