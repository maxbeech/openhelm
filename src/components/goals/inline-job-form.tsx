import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleType } from "@openorchestra/shared";

export interface InlineJob {
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  intervalMinutes: number;
  cronExpression: string;
  workingDirectory: string;
}

export const EMPTY_INLINE_JOB: InlineJob = {
  name: "",
  prompt: "",
  scheduleType: "once",
  intervalMinutes: 60,
  cronExpression: "0 9 * * 1",
  workingDirectory: "",
};

interface InlineJobFormProps {
  job: InlineJob;
  index: number;
  projectDirectory: string;
  touched: boolean;
  onChange: (updated: InlineJob) => void;
  onRemove: () => void;
}

export function InlineJobForm({
  job,
  index,
  projectDirectory,
  touched,
  onChange,
  onRemove,
}: InlineJobFormProps) {
  const set = (key: keyof InlineJob, value: string | number) =>
    onChange({ ...job, [key]: value });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Job {index + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="size-6 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          value={job.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Run test suite"
          className="h-8 text-sm"
        />
        {touched && !job.name.trim() && (
          <p className="text-xs text-destructive">Name is required</p>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Prompt <span className="text-destructive">*</span>
        </Label>
        <Textarea
          value={job.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder="Instructions for Claude Code..."
          rows={3}
          className="text-sm"
        />
        {touched && !job.prompt.trim() && (
          <p className="text-xs text-destructive">Prompt is required</p>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Schedule</Label>
        <Select
          value={job.scheduleType}
          onValueChange={(v) => set("scheduleType", v)}
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
        {job.scheduleType === "interval" && (
          <Input
            type="number"
            value={job.intervalMinutes}
            onChange={(e) => set("intervalMinutes", Number(e.target.value))}
            min={1}
            className="mt-1 h-8 text-sm"
            placeholder="Minutes between runs"
          />
        )}
        {job.scheduleType === "cron" && (
          <Input
            value={job.cronExpression}
            onChange={(e) => set("cronExpression", e.target.value)}
            className="mt-1 h-8 text-sm"
            placeholder="0 9 * * 1 (Mon 9am)"
          />
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Working directory</Label>
        <Input
          value={job.workingDirectory}
          onChange={(e) => set("workingDirectory", e.target.value)}
          placeholder={projectDirectory}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
