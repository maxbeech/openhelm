import { useEffect, useState } from "react";
import {
  Bell,
  Terminal,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureNotificationPermission } from "@/lib/notifications";
import * as api from "@/lib/api";

type PermStatus = "unknown" | "checking" | "granted" | "denied";

export function PermissionsSection() {
  const [notifStatus, setNotifStatus] = useState<PermStatus>("unknown");
  const [terminalStatus, setTerminalStatus] = useState<PermStatus>("unknown");
  const [wakeStatus, setWakeStatus] = useState<PermStatus>("unknown");

  useEffect(() => {
    checkAll();
  }, []);

  async function checkAll() {
    setTerminalStatus("checking");
    setWakeStatus("checking");

    const [terminal, wake] = await Promise.allSettled([
      api.checkTerminalAccess(),
      api.checkWakeAuth(),
    ]);
    setTerminalStatus(
      terminal.status === "fulfilled" && terminal.value.granted
        ? "granted"
        : "denied",
    );
    setWakeStatus(
      wake.status === "fulfilled" && wake.value.authorized
        ? "granted"
        : "denied",
    );
  }

  async function handleNotificationRequest() {
    setNotifStatus("checking");
    try {
      await ensureNotificationPermission();
      setNotifStatus("granted");
    } catch {
      setNotifStatus("denied");
    }
  }

  async function handleTerminalRequest() {
    setTerminalStatus("checking");
    try {
      const result = await api.requestTerminalAccess();
      setTerminalStatus(result.granted ? "granted" : "denied");
    } catch {
      setTerminalStatus("denied");
    }
  }

  function openSystemSettings() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/plugin-shell").then(({ open }) => {
      open("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation");
    }).catch(() => {});
  }

  return (
    <section>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Permissions
      </h3>
      <div className="space-y-4">
        <PermRow
          icon={<Bell className="size-4" />}
          title="Notifications"
          description="Receive alerts when jobs complete or need attention."
          status={notifStatus}
          actionLabel="Request Permission"
          onAction={handleNotificationRequest}
        />

        <PermRow
          icon={<Terminal className="size-4" />}
          title="Terminal Automation"
          description="Allows OpenHelm to open Claude Code sessions in Terminal."
          status={terminalStatus}
          actionLabel="Grant Access"
          onAction={handleTerminalRequest}
          settingsHint="If denied, enable in System Settings > Privacy & Security > Automation."
          onOpenSettings={openSystemSettings}
        />

        <PermRow
          icon={<Shield className="size-4" />}
          title="Wake Scheduling"
          description="Wake your Mac from sleep before scheduled jobs."
          status={wakeStatus}
          settingsHint="Configure in the Execution section above."
        />

        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Keychain Access</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Claude Code and its MCP servers may request keychain access for
                stored credentials. When macOS shows a keychain prompt, click{" "}
                <strong>"Always Allow"</strong> to persist the decision for that
                credential. This is a macOS security feature, not an OpenHelm
                setting.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PermRow({
  icon,
  title,
  description,
  status,
  actionLabel,
  onAction,
  settingsHint,
  onOpenSettings,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermStatus;
  actionLabel?: string;
  onAction?: () => void;
  settingsHint?: string;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {status === "checking" && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
          {status === "granted" && (
            <CheckCircle2 className="size-3.5 text-success" />
          )}
          {status === "denied" && (
            <AlertTriangle className="size-3.5 text-orange-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {status === "denied" && settingsHint && (
          <p className="mt-1 text-xs text-muted-foreground">
            {settingsHint}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Open <ExternalLink className="size-3" />
              </button>
            )}
          </p>
        )}
      </div>
      {onAction && status !== "granted" && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAction}
          disabled={status === "checking"}
          className="shrink-0"
        >
          {actionLabel ?? "Grant"}
        </Button>
      )}
    </div>
  );
}
