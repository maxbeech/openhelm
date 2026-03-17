import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";
import { setAnalyticsEnabled } from "@/lib/sentry";

export function ApplicationSection() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(true);

  useEffect(() => {
    invoke<boolean>("plugin:autostart|is_enabled")
      .then(setLaunchAtLogin)
      .catch(() => setLaunchAtLogin(false))
      .finally(() => setLaunchLoading(false));

    api
      .getSetting("analytics_enabled")
      .then((s) => setAnalyticsEnabledState(s?.value !== "false"))
      .catch(() => {});
  }, []);

  const toggleLaunchAtLogin = async (enabled: boolean) => {
    try {
      if (enabled) {
        await invoke("plugin:autostart|enable");
      } else {
        await invoke("plugin:autostart|disable");
      }
      setLaunchAtLogin(enabled);
    } catch (err) {
      console.error("Failed to toggle launch at login:", err);
    }
  };

  const toggleAnalytics = (checked: boolean) => {
    setAnalyticsEnabledState(checked);
    setAnalyticsEnabled(checked);
    api
      .setSetting({ key: "analytics_enabled", value: String(checked) })
      .catch(() => {});
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Application</h3>
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>Version: 0.1.0</p>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Launch at login</Label>
            <p className="text-xs text-muted-foreground">
              Start OpenOrchestra automatically when you log in.
            </p>
          </div>
          <Switch
            checked={launchAtLogin}
            onCheckedChange={toggleLaunchAtLogin}
            disabled={launchLoading}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm text-foreground">
              Share anonymous error reports
            </Label>
            <p className="text-xs text-muted-foreground">
              Send crash reports to help improve OpenOrchestra. No code,
              prompts, or file paths included.
            </p>
          </div>
          <Switch checked={analyticsEnabled} onCheckedChange={toggleAnalytics} />
        </div>
        <div className="flex gap-4">
          <a
            href="https://openorchestra.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            OpenOrchestra.ai <ExternalLink className="size-3" />
          </a>
          <a
            href="https://github.com/openorchestra/openorchestra"
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
