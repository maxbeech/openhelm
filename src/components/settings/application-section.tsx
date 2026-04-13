import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { setAnalyticsEnabled } from "@/lib/sentry";
import { setRecordingEnabled } from "@/lib/posthog";
import { ensureNotificationPermission } from "@/lib/notifications";
import { useUpdater } from "@/hooks/use-updater";
import { useUpdaterStore } from "@/stores/updater-store";
import { isLocalMode } from "@/lib/mode";
import type { NotificationLevel } from "@openhelm/shared";

export function ApplicationSection() {
  const [appVersion, setAppVersion] = useState<string>("…");
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);
  const [notifLevel, setNotifLevel] = useState<NotificationLevel>("alerts_only");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  const { setShouldCheckUpdates } = useUpdaterStore();
  const {
    status,
    updateVersion,
    error,
    activeRunCount,
    checkForUpdate,
    installUpdate,
    forceInstallUpdate,
    waitAndInstall,
    dismissUpdate,
  } = useUpdater();

  useEffect(() => {
    if (isLocalMode) {
      import("@tauri-apps/api/app").then(({ getVersion }) =>
        getVersion().then(setAppVersion).catch(() => {}),
      );
      import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<boolean>("plugin:autostart|is_enabled")
          .then(setLaunchAtLogin)
          .catch(() => setLaunchAtLogin(false))
          .finally(() => setLaunchLoading(false)),
      );
    } else {
      setAppVersion("cloud");
      setLaunchLoading(false);
    }

    api.getSetting("analytics_enabled")
      .then((s) => setAnalyticsEnabledState(s?.value !== "false"))
      .catch(() => {});

    api.getSetting("notification_level")
      .then((s) => {
        const v = s?.value;
        if (v === "never" || v === "on_finish" || v === "alerts_only") {
          setNotifLevel(v);
        }
      })
      .catch(() => {});

    api.getSetting("auto_update_enabled")
      .then((s) => setAutoUpdateEnabled(s?.value !== "false"))
      .catch(() => {});
  }, []);

  const toggleLaunchAtLogin = async (enabled: boolean) => {
    if (!isLocalMode) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
      setLaunchAtLogin(enabled);
    } catch (err) {
      console.error("Failed to toggle launch at login:", err);
    }
  };

  const toggleAnalytics = (checked: boolean) => {
    setAnalyticsEnabledState(checked);
    setAnalyticsEnabled(checked);
    setRecordingEnabled(checked);
    api.setSetting({ key: "analytics_enabled", value: String(checked) }).catch(() => {});
  };

  const changeNotifLevel = async (value: string) => {
    const level = value as NotificationLevel;
    setNotifLevel(level);
    await api.setSetting({ key: "notification_level", value: level }).catch(() => {});
    if (level !== "never") {
      await ensureNotificationPermission();
    }
  };

  const toggleAutoUpdate = (checked: boolean) => {
    setAutoUpdateEnabled(checked);
    setShouldCheckUpdates(checked);
    api.setSetting({ key: "auto_update_enabled", value: String(checked) }).catch(() => {});
  };

  const handleCheckNow = () => { void checkForUpdate(); };

  return (
    <div>
      <h3 className="mb-3 font-medium">Application</h3>
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>Version: {appVersion}</p>
        {isLocalMode && (
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Launch at login</Label>
              <p className="text-xs text-muted-foreground">
                Start OpenHelm automatically when you log in.
              </p>
            </div>
            <Switch checked={launchAtLogin} onCheckedChange={toggleLaunchAtLogin} disabled={launchLoading} />
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm text-foreground">Share anonymous error reports</Label>
            <p className="text-xs text-muted-foreground">
              Send crash reports to help improve OpenHelm. No code,
              prompts, or file paths included.
            </p>
          </div>
          <Switch checked={analyticsEnabled} onCheckedChange={toggleAnalytics} />
        </div>
        <div>
          <Label className="text-sm text-foreground">Notifications</Label>
          <p className="mb-2 text-xs text-muted-foreground">
            Choose when to receive native notifications.
          </p>
          <RadioGroup value={notifLevel} onValueChange={changeNotifLevel} className="space-y-2">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="on_finish" id="notif-finish" className="mt-0.5" />
              <div>
                <Label htmlFor="notif-finish" className="text-sm font-normal cursor-pointer">
                  Everything
                </Label>
                <p className="text-xs text-muted-foreground">
                  When any job finishes and when an alert needs your attention.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="alerts_only" id="notif-alerts" className="mt-0.5" />
              <div>
                <Label htmlFor="notif-alerts" className="text-sm font-normal cursor-pointer">
                  Alerts only (default)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Only when a job fails permanently or needs your input.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="never" id="notif-never" />
              <Label htmlFor="notif-never" className="text-sm font-normal cursor-pointer">
                Never
              </Label>
            </div>
          </RadioGroup>
        </div>
        {isLocalMode && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm text-foreground">Automatically install updates</Label>
                <p className="text-xs text-muted-foreground">
                  Check for and install new versions when available.
                </p>
              </div>
              <Switch checked={autoUpdateEnabled} onCheckedChange={toggleAutoUpdate} />
            </div>
            <div className="space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleCheckNow}
                disabled={status === "checking" || status === "downloading"}
              >
                {status === "checking" && <Loader2 className="mr-2 size-3 animate-spin" />}
                Check for Updates
              </Button>
              {status === "not-available" && (
                <p className="text-xs text-muted-foreground">OpenHelm is up to date.</p>
              )}
              {status === "available" && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Version {updateVersion} available.</p>
                  <Button size="xs" className="h-6 px-2 text-xs" onClick={() => void installUpdate()}>
                    Install &amp; Relaunch
                  </Button>
                </div>
              )}
              {status === "confirming" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    {activeRunCount} active {activeRunCount === 1 ? "run" : "runs"} — runs will auto-resume after update.
                  </p>
                  <Button size="xs" className="h-6 px-2 text-xs" onClick={() => void forceInstallUpdate()}>
                    Update Now
                  </Button>
                  <Button variant="outline" size="xs" className="h-6 px-2 text-xs" onClick={waitAndInstall}>
                    Wait for Runs
                  </Button>
                  <Button variant="ghost" size="xs" className="h-6 px-2 text-xs" onClick={dismissUpdate}>
                    Later
                  </Button>
                </div>
              )}
              {status === "waiting" && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Waiting for {activeRunCount} {activeRunCount === 1 ? "run" : "runs"} to finish…
                  </p>
                  <Button size="xs" className="h-6 px-2 text-xs" onClick={() => void forceInstallUpdate()}>
                    Update Now
                  </Button>
                  <Button variant="ghost" size="xs" className="h-6 px-2 text-xs" onClick={dismissUpdate}>
                    Cancel
                  </Button>
                </div>
              )}
              {status === "downloading" && (
                <p className="text-xs text-muted-foreground">Downloading update…</p>
              )}
              {status === "ready" && (
                <p className="text-xs text-muted-foreground">Installing update… relaunching shortly.</p>
              )}
              {status === "error" && (
                <p className="text-xs text-destructive">{error ?? "Update check failed"}</p>
              )}
            </div>
          </>
        )}
        <div className="flex gap-4">
          <a
            href="https://openhelm.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            OpenHelm.ai <ExternalLink className="size-3" />
          </a>
          <a
            href="https://github.com/openhelm/openhelm"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            GitHub <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
