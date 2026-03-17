import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import * as api from "@/lib/api";
import { setAnalyticsEnabled } from "@/lib/sentry";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);

  const handleAnalyticsChange = (checked: boolean | "indeterminate") => {
    const value = checked === true;
    setAnalyticsEnabledState(value);
    setAnalyticsEnabled(value);
    api
      .setSetting({ key: "analytics_enabled", value: String(value) })
      .catch(() => {});
  };

  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        <span className="text-primary">Open</span>Orchestra
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Turn high-level goals into scheduled, self-correcting Claude Code jobs.
      </p>
      <div className="mt-6 flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-left">
        <Checkbox
          id="analytics"
          checked={analyticsEnabled}
          onCheckedChange={(checked) => handleAnalyticsChange(!!checked)}
        />
        <label htmlFor="analytics" className="cursor-pointer">
          <span className="text-sm font-medium">Help improve OpenOrchestra</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Share anonymous crash reports to help us fix issues faster. No code,
            prompts, or file paths are ever included.
          </p>
        </label>
      </div>
      <Button onClick={onNext} size="lg" className="mt-8">
        Let's get started
      </Button>
    </div>
  );
}
