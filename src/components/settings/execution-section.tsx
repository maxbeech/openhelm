import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";
import { useLowTokenModeStore } from "@/stores/low-token-mode-store";

const DEFAULT_GLOBAL_PROMPT =
  `- If any tool or external service operation hangs with no progress for more than 3 minutes, abandon that specific operation and try an alternative approach. Do not wait indefinitely for unresponsive tools or services.
- When your task is fully complete and all results have been reported, stop working immediately. Do not wait for further instructions.
- If you encounter authentication failures, CAPTCHAs, or access blocks, log what happened and move on to the next item rather than retrying the same approach repeatedly.
- Prefer completing partial work over getting stuck. If one item in a batch fails, continue with the remaining items and report what succeeded and what failed at the end.`;

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? "am" : "pm";
  const h = i % 12 || 12;
  return `${h}:00 ${ampm}`;
});

export function ExecutionSection() {
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [timeout, setTimeout_] = useState("0");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [suppressWindows, setSuppressWindows] = useState(true);
  const [globalPrompt, setGlobalPrompt] = useState("");
  const { weeklyResetDow, weeklyResetHour, setWeeklyReset, clearWeeklyReset } = useLowTokenModeStore();

  useEffect(() => {
    Promise.all([
      api.getSetting("max_concurrent_runs"),
      api.getSetting("run_timeout_minutes"),
      api.getSetting("wake_schedule_enabled"),
      api.getSetting("focus_guard_enabled"),
      api.getSetting("global_prompt"),
    ]).then(([concurrent, to, wake, focusGuard, gp]) => {
      if (concurrent?.value) setMaxConcurrent(concurrent.value);
      if (to?.value) setTimeout_(to.value);
      if (wake?.value) setWakeEnabled(wake.value === "true");
      if (focusGuard?.value) setSuppressWindows(focusGuard.value !== "false");
      setGlobalPrompt(gp?.value ?? DEFAULT_GLOBAL_PROMPT);
    });
  }, []);

  async function handleWakeToggle(checked: boolean) {
    if (checked) {
      // Install sudoers entry — shows macOS password dialog
      const result = await api.installWakeAuth();
      if (!result.authorized) {
        // User cancelled the auth dialog — don't enable
        return;
      }
    }
    setWakeEnabled(checked);
    api.setSetting({ key: "wake_schedule_enabled", value: String(checked) });
  }

  const saveSetting = async (
    key: "max_concurrent_runs" | "run_timeout_minutes",
    value: string,
  ) => {
    await api.setSetting({ key, value });
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Execution</h3>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm">Max concurrent runs</Label>
          <Select
            value={maxConcurrent}
            onValueChange={(v) => {
              setMaxConcurrent(v);
              saveSetting("max_concurrent_runs", v);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Default: 2. Higher values run more jobs in parallel.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Default run timeout</Label>
          <Select
            value={timeout}
            onValueChange={(v) => {
              setTimeout_(v);
              saveSetting("run_timeout_minutes", v);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">No limit</SelectItem>
              <SelectItem value="10">10 minutes</SelectItem>
              <SelectItem value="20">20 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">60 minutes</SelectItem>
              <SelectItem value="120">120 minutes</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The silence timeout (10 min) catches stuck processes independently.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Wake Mac for scheduled jobs</Label>
            <p className="text-xs text-muted-foreground">
              Wake your Mac from sleep before scheduled jobs run. Requires
              administrator privileges. May not work with lid closed.
            </p>
          </div>
          <Switch
            checked={wakeEnabled}
            onCheckedChange={handleWakeToggle}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Suppress job windows</Label>
            <p className="text-xs text-muted-foreground">
              Automatically hide windows opened by running jobs so they don't
              steal focus. Hidden windows remain accessible via the Dock.
            </p>
          </div>
          <Switch
            checked={suppressWindows}
            onCheckedChange={(checked) => {
              setSuppressWindows(checked);
              api.setSetting({ key: "focus_guard_enabled", value: String(checked) });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Global prompt</Label>
          <Textarea
            value={globalPrompt}
            onChange={(e) => setGlobalPrompt(e.target.value)}
            onBlur={() => api.setSetting({ key: "global_prompt", value: globalPrompt })}
            rows={6}
            className="text-xs font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Appended to every job prompt. Use for general behavioral guidelines that should apply across all jobs.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Weekly Claude Code budget reset</Label>
          <p className="text-xs text-muted-foreground">
            When your Claude Code usage resets each week. Low token mode auto-disables at this time.
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={weeklyResetDow !== null ? String(weeklyResetDow) : "none"}
              onValueChange={(v) => {
                if (v === "none") { void clearWeeklyReset(); return; }
                void setWeeklyReset(parseInt(v, 10), weeklyResetHour ?? 0);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {DOW_LABELS.map((label, i) => (
                  <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {weeklyResetDow !== null && (
              <Select
                value={String(weeklyResetHour ?? 0)}
                onValueChange={(v) => void setWeeklyReset(weeklyResetDow, parseInt(v, 10))}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_LABELS.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
