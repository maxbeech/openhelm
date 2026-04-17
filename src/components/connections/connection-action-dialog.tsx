/**
 * ConnectionActionDialog — wraps InstallProgressStep for card-level actions.
 *
 * Used when the user clicks "Reinstall" or "Authenticate" on a ConnectionCard
 * after the initial create flow (e.g. install failed, or auth was skipped).
 */

import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InstallProgressStep } from "./install-progress-step";
import * as api from "@/lib/api";
import type { Connection } from "@openhelm/shared";

interface Props {
  connection: Connection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionActionDialog({ connection, open, onOpenChange }: Props) {
  if (!connection) return null;

  const isMcpOrCli = connection.type === "mcp" || connection.type === "cli";
  if (!isMcpOrCli) return null;

  const needsReinstall =
    connection.installStatus === "failed" || connection.installStatus === "pending";
  const needsAuth =
    connection.installStatus === "installed" &&
    (connection.authStatus === "unauthenticated" ||
      connection.authStatus === "expired" ||
      connection.authStatus === "revoked");

  const initialPhase = needsAuth ? "auth_pending" : "installing";

  const title = needsReinstall
    ? `Reinstall ${connection.name}`
    : `Authenticate ${connection.name}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {open && (
            <ActionDialogBody
              connection={connection}
              connectionType={connection.type as "mcp" | "cli"}
              initialPhase={initialPhase}
              needsReinstall={needsReinstall}
              onDone={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialogBody({
  connection,
  connectionType,
  initialPhase,
  needsReinstall,
  onDone,
  onCancel,
}: {
  connection: Connection;
  connectionType: "mcp" | "cli";
  initialPhase: "installing" | "auth_pending";
  needsReinstall: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Trigger the reinstall immediately when the dialog opens for a failed install.
  useEffect(() => {
    if (needsReinstall) {
      api.reinstallConnection(connection.id).catch((err) => {
        console.error("[ConnectionActionDialog] reinstall failed:", err);
      });
    }
  }, [connection.id, needsReinstall]);

  return (
    <InstallProgressStep
      connectionId={connection.id}
      connectionType={connectionType}
      initialPhase={initialPhase}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}
