import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Terminal, Shield, Mic, CheckCircle2, Loader2 } from "lucide-react";
import { ensureNotificationPermission } from "@/lib/notifications";
import * as api from "@/lib/api";

interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: "idle" | "loading" | "granted" | "info";
  actionLabel?: string;
  onAction?: () => void;
}

function PermissionRow({ icon, title, description, status, actionLabel, onAction }: PermissionRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-4 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {status === "granted" && (
            <CheckCircle2 className="size-4 text-success" />
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {status !== "info" && onAction && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAction}
          disabled={status === "loading" || status === "granted"}
          className="shrink-0"
        >
          {status === "loading" ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : null}
          {status === "granted" ? "Granted" : (actionLabel ?? "Grant Access")}
        </Button>
      )}
    </div>
  );
}

export function PermissionsStep({ onNext }: { onNext: () => void }) {
  const [notifStatus, setNotifStatus] = useState<"idle" | "loading" | "granted">("idle");
  const [terminalStatus, setTerminalStatus] = useState<"idle" | "loading" | "granted">("idle");
  const [micStatus, setMicStatus] = useState<"idle" | "loading" | "granted">("idle");

  const handleMicAccess = async () => {
    setMicStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // immediately stop; we just need the permission
      setMicStatus("granted");
    } catch {
      setMicStatus("idle");
    }
  };

  const handleNotifications = async () => {
    setNotifStatus("loading");
    try {
      await ensureNotificationPermission();
      setNotifStatus("granted");
    } catch {
      setNotifStatus("idle");
    }
  };

  const handleTerminalAccess = async () => {
    setTerminalStatus("loading");
    try {
      const result = await api.requestTerminalAccess();
      setTerminalStatus(result.granted ? "granted" : "idle");
    } catch {
      setTerminalStatus("idle");
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-2xl font-semibold">Permissions</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        OpenHelm needs a few macOS permissions to work properly. Grant them now
        so you won't be interrupted later.
      </p>

      <div className="mt-6 space-y-3">
        <PermissionRow
          icon={<Bell className="size-5" />}
          title="Notifications"
          description="Get alerted when jobs complete or need your attention."
          status={notifStatus}
          actionLabel="Allow"
          onAction={handleNotifications}
        />

        <PermissionRow
          icon={<Terminal className="size-5" />}
          title="Terminal Access"
          description="Open Claude Code sessions in Terminal when resuming runs."
          status={terminalStatus}
          actionLabel="Grant Access"
          onAction={handleTerminalAccess}
        />

        <PermissionRow
          icon={<Mic className="size-5" />}
          title="Microphone"
          description="Used for voice chat — speak to create goals, jobs, and manage your project hands-free."
          status={micStatus}
          actionLabel="Allow"
          onAction={handleMicAccess}
        />

        <PermissionRow
          icon={<Shield className="size-5" />}
          title="Keychain Access"
          description={
            "Claude Code may request access to stored credentials for MCP " +
            "integrations. When prompted by macOS, click \"Always Allow\" to " +
            "persist the decision."
          }
          status="info"
        />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        All permissions are optional. You can change these later in Settings.
      </p>

      <Button onClick={onNext} className="mt-6">
        Continue
      </Button>
    </div>
  );
}
