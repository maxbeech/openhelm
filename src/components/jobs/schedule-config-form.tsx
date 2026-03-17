import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleType } from "@openorchestra/shared";
import type { JobFormState } from "./job-creation-form";

export interface ScheduleConfigFormProps {
  form: JobFormState;
  intervalError: string | null;
  calendarError: string | null;
  onFieldChange: (field: keyof JobFormState, value: string | number | number[]) => void;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleConfigForm({
  form,
  intervalError,
  calendarError,
  onFieldChange,
}: ScheduleConfigFormProps) {
  const { scheduleType } = form;

  if (scheduleType === "interval") {
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex gap-2">
          <NumberStepper
            value={form.intervalAmount}
            onChange={(n) => onFieldChange("intervalAmount", n)}
            min={1}
            aria-label="Interval amount"
            className="shrink-0"
          />
          <Select
            value={form.intervalUnit}
            onValueChange={(v) => onFieldChange("intervalUnit", v)}
          >
            <SelectTrigger className="h-9 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {intervalError && (
          <p className="text-xs text-destructive">{intervalError}</p>
        )}
      </div>
    );
  }

  if (scheduleType === "calendar") {
    const selectedDays = form.calendarDaysOfWeek;

    const toggleDay = (day: number) => {
      if (selectedDays.includes(day)) {
        // Prevent deselecting the last day
        if (selectedDays.length === 1) return;
        onFieldChange("calendarDaysOfWeek", selectedDays.filter((d) => d !== day));
      } else {
        onFieldChange("calendarDaysOfWeek", [...selectedDays, day].sort((a, b) => a - b));
      }
    };

    return (
      <div className="mt-1.5 space-y-2">
        <div className="flex gap-2">
          <Select
            value={form.calendarFrequency}
            onValueChange={(v) => onFieldChange("calendarFrequency", v)}
          >
            <SelectTrigger className="h-9 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="time"
            value={form.calendarTime}
            onChange={(e) => onFieldChange("calendarTime", e.target.value)}
            className="h-9 w-28 text-sm"
            aria-label="Time"
          />
        </div>
        {form.calendarFrequency === "weekly" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Days of week</Label>
            <div className="flex gap-1" role="group" aria-label="Days of week">
              {DAY_LABELS.map((label, day) => {
                const active = selectedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={active}
                    aria-label={DAY_NAMES[day]}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {selectedDays.length === 0 && (
              <p className="text-xs text-destructive">Select at least one day</p>
            )}
          </div>
        )}
        {form.calendarFrequency === "monthly" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Day of month</Label>
            <NumberStepper
              value={form.calendarDayOfMonth}
              onChange={(n) => onFieldChange("calendarDayOfMonth", n)}
              min={1}
              max={31}
              aria-label="Day of month"
            />
          </div>
        )}
        {calendarError && (
          <p className="text-xs text-destructive">{calendarError}</p>
        )}
      </div>
    );
  }

  if (scheduleType === "cron") {
    return (
      <Input
        value={(form as JobFormState & { cronExpression?: string }).cronExpression ?? ""}
        onChange={(e) => onFieldChange("cronExpression" as keyof JobFormState, e.target.value)}
        className="mt-1.5 h-9 text-sm"
        placeholder="0 9 * * 1 (Mon 9am)"
        aria-label="Cron expression"
      />
    );
  }

  // "once" and "manual" — no sub-form
  return null;
}

// Re-export ScheduleType for convenience
export type { ScheduleType };
