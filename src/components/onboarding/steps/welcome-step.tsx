import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import * as api from "@/lib/api";
import { setAnalyticsEnabled } from "@/lib/sentry";
import { ensureNotificationPermission } from "@/lib/notifications";
import logo from "@/assets/logo.svg";
import type { NotificationLevel } from "@openhelm/shared";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);
  const [notifLevel, setNotifLevel] = useState<NotificationLevel>("alerts_only");

  const handleAnalyticsChange = (checked: boolean | "indeterminate") => {
    const value = checked === true;
    setAnalyticsEnabledState(value);
    setAnalyticsEnabled(value);
    api
      .setSetting({ key: "analytics_enabled", value: String(value) })
      .catch(() => {});
  };

  const handleNotifLevelChange = (value: string) => {
    const level = value as NotificationLevel;
    setNotifLevel(level);
    api.setSetting({ key: "notification_level", value: level }).catch(() => {});
    if (level !== "never") {
      ensureNotificationPermission().catch(() => {});
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center gap-3">
        <img src={logo} alt="OpenHelm logo" className="h-12 w-12" />
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-primary">Open</span>Helm
        </h1>
      </div>
      <p className="mt-4 text-lg text-muted-foreground">
        Turn high-level goals into scheduled, self-correcting Claude Code jobs.
      </p>
      <div className="mt-6 flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-left">
        <Checkbox
          id="analytics"
          checked={analyticsEnabled}
          onCheckedChange={(checked) => handleAnalyticsChange(!!checked)}
          className="mt-0.5"
        />
        <label htmlFor="analytics" className="cursor-pointer">
          <span className="text-sm font-medium">Help improve OpenHelm</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Share anonymous crash reports to help us fix issues faster. No code,
            prompts, or file paths are ever included.
          </p>
        </label>
      </div>
      <div className="mt-3 flex w-full max-w-sm flex-col gap-2 rounded-lg border px-4 py-3 text-left">
        <span className="text-sm font-medium">Notifications</span>
        <p className="text-xs text-muted-foreground">
          Choose when OpenHelm should notify you.
        </p>
        <RadioGroup
          value={notifLevel}
          onValueChange={handleNotifLevelChange}
          className="mt-1 space-y-1"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="alerts_only" id="onb-notif-alerts" />
            <Label
              htmlFor="onb-notif-alerts"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Alerts only — when something needs your attention (recommended)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="on_finish" id="onb-notif-finish" />
            <Label
              htmlFor="onb-notif-finish"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              All job completions — notify when any job finishes
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="never" id="onb-notif-never" />
            <Label
              htmlFor="onb-notif-never"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Never
            </Label>
          </div>
        </RadioGroup>
      </div>
      <Button
        onClick={() => {
          // Always persist the chosen level (even if the default was never changed)
          api
            .setSetting({ key: "notification_level", value: notifLevel })
            .catch(() => {});
          if (notifLevel !== "never") {
            ensureNotificationPermission().catch(() => {});
          }
          onNext();
        }}
        size="lg"
        className="mt-8"
      >
        Let's get started
      </Button>
    </div>
  );
}
