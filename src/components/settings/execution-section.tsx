import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";

export function ExecutionSection() {
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [timeout, setTimeout_] = useState("0");
  const [autoCorrect, setAutoCorrect] = useState(true);
  const [maxRetries, setMaxRetries] = useState("2");

  useEffect(() => {
    Promise.all([
      api.getSetting("max_concurrent_runs"),
      api.getSetting("run_timeout_minutes"),
      api.getSetting("auto_correction_enabled"),
      api.getSetting("max_correction_retries"),
    ]).then(([concurrent, to, correction, retries]) => {
      if (concurrent?.value) setMaxConcurrent(concurrent.value);
      if (to?.value) setTimeout_(to.value);
      if (correction?.value) setAutoCorrect(correction.value !== "false");
      if (retries?.value) setMaxRetries(retries.value);
    });
  }, []);

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
      </div>
    </div>
  );
}
