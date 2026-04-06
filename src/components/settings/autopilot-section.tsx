import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as api from "@/lib/api";
import type { AutopilotMode } from "@openhelm/shared";

const MODE_LABELS: Record<AutopilotMode, string> = {
  off: "Off",
  approval_required: "With Approvals",
  full_auto: "Full Auto",
};

const MODE_DESCRIPTIONS: Record<AutopilotMode, string> = {
  off: "All autonomous behavior disabled. Jobs run on schedule but failures are not auto-corrected and no system monitoring jobs are created.",
  approval_required: "Failed runs are auto-corrected. System monitoring jobs are proposed for your review before activation.",
  full_auto: "Failed runs are auto-corrected. System monitoring jobs are created and run automatically.",
};

export function AutopilotSection() {
  const [mode, setMode] = useState<AutopilotMode>("full_auto");
  const [maxRetries, setMaxRetries] = useState("2");
  const [captainInterval, setCaptainInterval] = useState("30");

  useEffect(() => {
    Promise.all([
      api.getSetting("autopilot_mode"),
      api.getSetting("max_correction_retries"),
      api.getSetting("autopilot_scan_interval_minutes"),
    ]).then(([autopilot, retries, interval]) => {
      if (autopilot?.value) setMode(autopilot.value as AutopilotMode);
      if (retries?.value) setMaxRetries(retries.value);
      if (interval?.value) setCaptainInterval(interval.value);
    });
  }, []);

  return (
    <div>
      <h3 className="mb-3 font-medium">Autopilot</h3>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm">Mode</Label>
          <Select
            value={mode}
            onValueChange={(v) => {
              const newMode = v as AutopilotMode;
              setMode(newMode);
              api.setSetting({ key: "autopilot_mode", value: newMode });
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{MODE_LABELS.off}</SelectItem>
              <SelectItem value="approval_required">
                {MODE_LABELS.approval_required}
              </SelectItem>
              <SelectItem value="full_auto">
                {MODE_LABELS.full_auto}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {MODE_DESCRIPTIONS[mode]}
          </p>
        </div>

        {mode !== "off" && (
          <div className="space-y-1.5">
            <Label className="text-sm">Autopilot scan frequency</Label>
            <Select
              value={captainInterval}
              onValueChange={(v) => {
                setCaptainInterval(v);
                api.setSetting({ key: "autopilot_scan_interval_minutes", value: v });
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How often Autopilot scans system health. Skips when nothing has changed.
            </p>
          </div>
        )}

        {mode !== "off" && (
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
      </div>
    </div>
  );
}
