import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useProjectStore } from "@/stores/project-store";
import { ScopeMultiSelect } from "../credentials/scope-multi-select";
import type { Connection, ConnectionValue, ConnectionScopeBinding, FolderConfig } from "@openhelm/shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: Connection | null;
  onSave: (data: {
    id: string;
    name?: string;
    value?: ConnectionValue;
    config?: Partial<FolderConfig>;
    scopes?: ConnectionScopeBinding[] | null;
    isEnabled?: boolean;
  }) => void | Promise<void>;
}

export function ConnectionEditDialog({ open, onOpenChange, connection, onSave }: Props) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [scopes, setScopes] = useState<ConnectionScopeBinding[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (connection) {
      setName(connection.name);
      setScopes(connection.scopes ?? []);
      setIsEnabled(connection.isEnabled);
      setValue(""); setUsername(""); setPassword("");
      if (connection.type === "folder") {
        setFolderPath((connection.config as FolderConfig).path ?? "");
      }
    }
  }, [connection]);

  const canSave = connection && name.trim();

  const handleSave = useCallback(async () => {
    if (!canSave || !connection) return;
    setSaving(true); setSaveError(null);

    let credValue: ConnectionValue | undefined;
    if (connection.type === "plain_text") {
      if (username.trim() && password.trim()) credValue = { type: "username_password", username, password };
      else if (username.trim() || password.trim()) {
        setSaveError("Fill in both username and password to update credentials."); setSaving(false); return;
      }
    } else if (connection.type === "token" && value.trim()) {
      credValue = { type: "token", value };
    }

    const configUpdate = connection.type === "folder" && folderPath.trim()
      ? { path: folderPath.trim() }
      : undefined;

    try {
      await onSave({ id: connection.id, name: name.trim(), value: credValue, config: configUpdate, scopes, isEnabled });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [canSave, connection, name, value, username, password, folderPath, scopes, isEnabled, onSave, onOpenChange]);

  if (!connection) return null;

  const showValueField = connection.type === "token" || connection.type === "plain_text";
  const showFolderField = connection.type === "folder";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Connection</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              {(connection.type === "token" || connection.type === "plain_text") && (
                <p className="mt-1 font-mono text-2xs text-muted-foreground">
                  Env var: {connection.envVarName}
                  {name.trim() !== connection.name && <span className="ml-2 text-amber-400/80">(will change on save)</span>}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </div>

            {showValueField && (
              <div>
                <Label>New Value</Label>
                <p className="text-2xs text-muted-foreground mb-1.5">Leave empty to keep the current value.</p>
                {connection.type === "plain_text" ? (
                  <div className="space-y-2">
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="New username" />
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" />
                  </div>
                ) : (
                  <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New value" />
                )}
              </div>
            )}

            {showFolderField && (
              <div>
                <Label>Folder Path</Label>
                <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} />
              </div>
            )}

            <div>
              <Label className="mb-2 block">Scope</Label>
              <ScopeMultiSelect projects={projects} goals={goals} jobs={jobs} value={scopes} onChange={setScopes} />
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          {saveError && <p className="mr-auto text-xs text-destructive">{saveError}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
