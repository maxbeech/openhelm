import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import * as api from "@/lib/api";
import type { AutopilotMode } from "@openhelm/shared";

interface AutopilotStepProps {
  onNext: () => void;
}

const OPTIONS: { value: AutopilotMode; label: string; description: string }[] = [
  {
    value: "full_auto",
    label: "Full Auto",
    description: "Handle it automatically. Failed runs are retried and monitoring jobs are created without asking.",
  },
  {
    value: "approval_required",
    label: "With Approvals",
    description: "Propose changes for your review. Failed runs are retried, but new monitoring jobs need your approval.",
  },
  {
    value: "off",
    label: "Off",
    description: "Fully manual. No automatic retries or monitoring jobs.",
  },
];

export function AutopilotStep({ onNext }: AutopilotStepProps) {
  const [mode, setMode] = useState<AutopilotMode>("full_auto");
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setSaving(true);
    try {
      await api.setSetting({ key: "autopilot_mode", value: mode });
      onNext();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="size-6 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Autopilot</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          OpenHelm can autonomously monitor your goals, correct failed jobs, and
          keep things running smoothly.
        </p>
      </div>

      <RadioGroup
        value={mode}
        onValueChange={(v) => setMode(v as AutopilotMode)}
        className="w-full max-w-sm space-y-3 text-left"
      >
        {OPTIONS.map((opt) => (
          <Label
            key={opt.value}
            htmlFor={`autopilot-${opt.value}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
          >
            <RadioGroupItem value={opt.value} id={`autopilot-${opt.value}`} className="mt-0.5" />
            <div>
              <span className="text-sm font-medium">
                {opt.label}
                {opt.value === "full_auto" && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(Recommended)</span>
                )}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </Label>
        ))}
      </RadioGroup>

      <Button onClick={handleContinue} disabled={saving} className="w-full max-w-sm">
        {saving ? "Saving..." : "Continue"}
      </Button>
    </div>
  );
}
