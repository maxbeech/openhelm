import { useState, useCallback } from "react";
import { Eye, EyeOff, Pencil, Trash2, Globe, Folder, Target, Briefcase, CheckCircle2, AlertCircle, Loader2, Lock, RefreshCw, KeyRound } from "lucide-react";
import { ConnectionTypeBadge } from "./connection-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/stores/connection-store";
import { ConnectionActionDialog } from "./connection-action-dialog";
import type { Connection, ConnectionWithValue, FolderConfig } from "@openhelm/shared";

const scopeIcons: Record<string, typeof Globe> = {
  global: Globe, project: Folder, goal: Target, job: Briefcase,
};
const scopeLabels: Record<string, string> = {
  global: "All Projects", project: "Project", goal: "Goal", job: "Job",
};

function InstallBadge({ status }: { status: Connection["installStatus"] }) {
  if (status === "not_applicable") return null;
  if (status === "installed") return (
    <Badge variant="outline" className="text-3xs text-green-400 border-green-500/20">
      <CheckCircle2 className="mr-1 size-2.5" /> Installed
    </Badge>
  );
  if (status === "installing" || status === "pending") return (
    <Badge variant="outline" className="text-3xs text-blue-400 border-blue-500/20">
      <Loader2 className="mr-1 size-2.5 animate-spin" /> Installing
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-3xs text-red-400 border-red-500/20">
      <AlertCircle className="mr-1 size-2.5" /> Install failed
    </Badge>
  );
}

function AuthBadge({ status }: { status: Connection["authStatus"] }) {
  if (status === "not_applicable") return null;
  if (status === "authenticated") return (
    <Badge variant="outline" className="text-3xs text-green-400 border-green-500/20">
      <CheckCircle2 className="mr-1 size-2.5" /> Authenticated
    </Badge>
  );
  if (status === "unauthenticated") return (
    <Badge variant="outline" className="text-3xs text-muted-foreground">
      Not connected
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-3xs text-amber-400 border-amber-500/20">
      <AlertCircle className="mr-1 size-2.5" />
      {status === "expired" ? "Token expired" : "Revoked"}
    </Badge>
  );
}

function formatValue(cred: ConnectionWithValue): string {
  if (!cred.value || cred.value.type === "none") return "(empty)";
  if (cred.value.type === "username_password") return `${cred.value.username} / ${cred.value.password}`;
  return cred.value.value;
}

interface Props {
  connection: Connection;
  onEdit: (connection: Connection) => void;
  onDelete: (id: string) => void;
}

export function ConnectionCard({ connection, onEdit, onDelete }: Props) {
  const { revealValue } = useConnectionStore();
  const [revealed, setRevealed] = useState<ConnectionWithValue | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);

  const showInstallAction =
    (connection.type === "mcp" || connection.type === "cli") &&
    (connection.installStatus === "failed" || connection.installStatus === "pending");

  const showAuthAction =
    (connection.type === "mcp" || connection.type === "cli") &&
    connection.installStatus === "installed" &&
    (connection.authStatus === "unauthenticated" ||
      connection.authStatus === "expired" ||
      connection.authStatus === "revoked");

  const ScopeIcon = scopeIcons[connection.scopeType] ?? Globe;
  const showReveal = connection.type === "token" || connection.type === "plain_text";

  const handleReveal = useCallback(async () => {
    if (revealed) { setRevealed(null); return; }
    setRevealError(false);
    setRevealing(true);
    try {
      const result = await revealValue(connection.id);
      setRevealed(result);
      setTimeout(() => setRevealed(null), 30_000);
    } catch {
      setRevealError(true);
    } finally {
      setRevealing(false);
    }
  }, [connection.id, revealed, revealValue]);

  const folderPath = connection.type === "folder"
    ? (connection.config as FolderConfig).path
    : null;

  return (
    <div className="group rounded-lg border border-border bg-card p-3">
      {/* Row 1: Name + badges */}
      <div className="mb-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-foreground">{connection.name}</span>
        <ConnectionTypeBadge type={connection.type} />
        <Badge variant="outline" className="text-3xs text-muted-foreground">
          <ScopeIcon className="mr-1 size-2.5" />
          {scopeLabels[connection.scopeType]}
        </Badge>
        <InstallBadge status={connection.installStatus} />
        <AuthBadge status={connection.authStatus} />
        {!connection.isEnabled && (
          <Badge variant="outline" className="text-3xs text-yellow-400 border-yellow-500/20">Disabled</Badge>
        )}
        {!connection.isDeletable && (
          <Badge variant="outline" className="text-3xs text-muted-foreground/60">
            <Lock className="mr-1 size-2.5" /> Primary
          </Badge>
        )}
      </div>

      {/* Row 2: Env var or path */}
      <div className="mb-2 text-xs text-muted-foreground">
        {folderPath ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-3xs">{folderPath}</code>
        ) : connection.envVarName ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-3xs">
            {connection.type === "plain_text"
              ? `${connection.envVarName}_USERNAME / ${connection.envVarName}_PASSWORD`
              : connection.envVarName}
          </code>
        ) : null}
      </div>

      {/* Row 3: Value + actions */}
      <div className="flex items-center gap-2">
        {showReveal && (
          <div className="flex-1 font-mono text-xs text-muted-foreground">
            {revealError ? (
              <span className="text-destructive">Failed to reveal</span>
            ) : revealed ? (
              formatValue(revealed)
            ) : (
              "••••••••••••"
            )}
          </div>
        )}
        {!showReveal && <div className="flex-1" />}

        {showReveal && (
          <Button size="sm" variant="ghost" className="size-7 p-0"
            onClick={handleReveal} disabled={revealing}
            title={revealed ? "Hide value" : "Reveal value"}>
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="size-7 p-0 opacity-0 group-hover:opacity-100"
          onClick={() => onEdit(connection)} title="Edit">
          <Pencil className="size-3.5" />
        </Button>
        {connection.isDeletable && (
          confirmDelete ? (
            <Button size="sm" variant="destructive" className="h-7 text-2xs"
              onClick={() => { onDelete(connection.id); setConfirmDelete(false); }}>
              Confirm
            </Button>
          ) : (
            <Button size="sm" variant="ghost"
              className="size-7 p-0 opacity-0 group-hover:opacity-100 text-destructive"
              onClick={() => setConfirmDelete(true)} title="Delete">
              <Trash2 className="size-3.5" />
            </Button>
          )
        )}
      </div>

      {/* Reinstall / Authenticate actions */}
      {(showInstallAction || showAuthAction) && (
        <div className="mt-2 border-t border-border pt-2">
          {showInstallAction && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-2xs"
              onClick={() => setActionDialogOpen(true)}
            >
              <RefreshCw className="mr-1.5 size-3" />
              Retry install
            </Button>
          )}
          {showAuthAction && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-2xs"
              onClick={() => setActionDialogOpen(true)}
            >
              <KeyRound className="mr-1.5 size-3" />
              {connection.authStatus === "unauthenticated" ? "Authenticate" : "Reconnect"}
            </Button>
          )}
        </div>
      )}

      {connection.lastUsedAt && (
        <p className="mt-1.5 text-3xs text-muted-foreground/60">
          Last used {new Date(connection.lastUsedAt).toLocaleDateString()}
        </p>
      )}

      <ConnectionActionDialog
        connection={connection}
        open={actionDialogOpen}
        onOpenChange={setActionDialogOpen}
      />
    </div>
  );
}
