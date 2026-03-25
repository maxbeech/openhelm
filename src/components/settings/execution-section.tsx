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

const DEFAULT_GLOBAL_PROMPT =
  `- If any tool or external service operation hangs with no progress for more than 3 minutes, abandon that specific operation and try an alternative approach. Do not wait indefinitely for unresponsive tools or services.
- When your task is fully complete and all results have been reported, stop working immediately. Do not wait for further instructions.
- If you encounter authentication failures, CAPTCHAs, or access blocks, log what happened and move on to the next item rather than retrying the same approach repeatedly.
- Prefer completing partial work over getting stuck. If one item in a batch fails, continue with the remaining items and report what succeeded and what failed at the end.`;

export function ExecutionSection() {
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [timeout, setTimeout_] = useState("0");
  const [autoCorrect, setAutoCorrect] = useState(true);
  const [maxRetries, setMaxRetries] = useState("2");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [suppressWindows, setSuppressWindows] = useState(true);
  const [globalPrompt, setGlobalPrompt] = useState("");

  useEffect(() => {
    Promise.all([
      api.getSetting("max_concurrent_runs"),
      api.getSetting("run_timeout_minutes"),
      api.getSetting("auto_correction_enabled"),
      api.getSetting("max_correction_retries"),
      api.getSetting("wake_schedule_enabled"),
      api.getSetting("focus_guard_enabled"),
      api.getSetting("global_prompt"),
    ]).then(([concurrent, to, correction, retries, wake, focusGuard, gp]) => {
      if (concurrent?.value) setMaxConcurrent(concurrent.value);
      if (to?.value) setTimeout_(to.value);
      if (correction?.value) setAutoCorrect(correction.value !== "false");
      if (retries?.value) setMaxRetries(retries.value);
      if (wake?.value) setWakeEnabled(wake.value === "true");
      // focus_guard_enabled defaults to true; only stored when explicitly disabled
      if (focusGuard?.value) setSuppressWindows(focusGuard.value !== "false");
      // Use stored value or seed with default (don't persist yet — only on first blur)
      setGlobalPrompt(gp?.value ?? DEFAULT_GLOBAL_PROMPT);
    });
  }, []);

  async function handleWakeToggle(checked: boolean) {
    if (checked) {
      // Verify admin auth before enabling — shows macOS password dialog
      const result = await api.checkWakeAuth();
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
            <Label className="text-sm">Auto-correct failed runs</Label>
            <p className="text-xs text-muted-foreground">
              When a run fails, analyze the error and automatically retry with
              correction context.
            </p>
          </div>
          <Switch
            checked={autoCorrect}
            onCheckedChange={(checked) => {
              setAutoCorrect(checked);
              api.setSetting({
                key: "auto_correction_enabled",
                value: String(checked),
              });
            }}
          />
        </div>
        {autoCorrect && (
          <div className="space-y-1.5">
            <Label className="text-sm">Max correction retries</Label>
            <Select
              value={maxRetries}
              onValueChange={(v) => {
                setMaxRetries(v);
                api.setSetting({ key: "max_correction_retries", value: v });
              }}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How many times to retry a failed run with correction guidance.
              Default: 2 (original + up to 2 corrections = 3 total attempts).
            </p>
          </div>
        )}
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
      </div>
    </div>
  );
}
