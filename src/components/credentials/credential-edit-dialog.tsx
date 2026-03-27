import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, AlertTriangle } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useProjectStore } from "@/stores/project-store";
import { ScopeMultiSelect } from "./scope-multi-select";
import type { Credential, CredentialValue, CredentialScopeBinding } from "@openhelm/shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: Credential | null;
  projectId: string | null;
  onSave: (data: {
    id: string;
    name?: string;
    allowPromptInjection?: boolean;
    value?: CredentialValue;
    scopes?: CredentialScopeBinding[] | null;
    isEnabled?: boolean;
  }) => void | Promise<void>;
}

export function CredentialEditDialog({ open, onOpenChange, credential, projectId, onSave }: Props) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const [name, setName] = useState("");
  const [allowPromptInjection, setAllowPromptInjection] = useState(false);
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopes, setScopes] = useState<CredentialScopeBinding[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (credential) {
      setName(credential.name);
      setAllowPromptInjection(credential.allowPromptInjection);
      setScopes(credential.scopes ?? []);
      setIsEnabled(credential.isEnabled);
      setValue("");
      setUsername("");
      setPassword("");
    }
  }, [credential]);

  const canSave = credential && name.trim();

  const handleSave = useCallback(async () => {
    if (!canSave || !credential) return;
    setSaving(true);

    // Only send value if the user typed something new
    let credValue: CredentialValue | undefined;
    if (credential.type === "username_password") {
      if (username.trim() || password.trim()) {
        credValue = { type: "username_password", username, password };
      }
    } else {
      if (value.trim()) {
        credValue = { type: "token", value };
      }
    }

    try {
      await onSave({
        id: credential.id,
        name: name.trim(),
        allowPromptInjection,
        value: credValue,
        scopes,
        isEnabled,
      });
    } finally {
      setSaving(false);
      onOpenChange(false);
    }
  }, [canSave, credential, name, allowPromptInjection, value, username, password, scopes, isEnabled, onSave, onOpenChange]);

  if (!credential) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Credential</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
        <div className="space-y-4">
          {/* Risk notice — always shown */}
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-200/70">
              OpenHelm cannot fully control how Claude Code handles credentials at runtime.
              Credentials may be read by shell commands. You use this feature at your own risk.
            </p>
          </div>

          {/* Name */}
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Env var: <span className="text-foreground/70">{credential.envVarName}</span>
              {credential.type === "username_password" && (
                <span className="text-muted-foreground/60">
                  {" "}/ {credential.envVarName}_USERNAME / {credential.envVarName}_PASSWORD
                </span>
              )}
              {name.trim() !== credential.name && (
                <span className="ml-2 text-amber-400/80">(will change on save)</span>
              )}
            </p>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>

          {/* Value — leave empty to keep existing */}
          <div>
            <Label>Value</Label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Leave empty to keep the current value.
            </p>
            {credential.type === "username_password" ? (
              <div className="space-y-2">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="New username (unchanged if empty)" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (unchanged if empty)" />
              </div>
            ) : (
              <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New value (unchanged if empty)" />
            )}
          </div>

          {/* Prompt access toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Allow prompt access</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Also inject credential value into the prompt text
                </p>
              </div>
              <Switch checked={allowPromptInjection} onCheckedChange={setAllowPromptInjection} />
            </div>

            {allowPromptInjection ? (
              <div className="space-y-2">
                <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                  <p className="text-[11px] text-red-300/80">
                    <strong>Elevated risk:</strong> The credential value will be included in the prompt text and{" "}
                    <strong>sent to Anthropic&apos;s servers</strong>. Enable only if Claude Code needs to
                    type or paste the value directly.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
                  <p className="text-[11px] font-medium text-foreground/80">Use prompt access when Claude needs to:</p>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground list-disc list-inside">
                    <li>Log in to a website by typing a password into a form</li>
                    <li>Paste an API key directly into a config file as literal text</li>
                    <li>Reference the value by name in shell commands it writes</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 rounded-md border border-green-500/20 bg-green-500/5 p-2.5">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-green-400" />
                  <p className="text-[11px] text-green-300/80">
                    Env var only. Value is <strong>not automatically sent to Anthropic</strong>, but Claude Code
                    can still read it via shell commands.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
                  <p className="text-[11px] font-medium text-foreground/80">Environment variable is enough when:</p>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground list-disc list-inside">
                    <li>Your code reads it via <code className="text-[10px]">process.env.OPENHELM_*</code></li>
                    <li>A CLI tool picks it up automatically (e.g. <code className="text-[10px]">AWS_ACCESS_KEY_ID</code>)</li>
                    <li>Claude calls an API using the env var without needing to know its value</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Scope */}
          <div>
            <Label className="mb-2 block">Scope</Label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Leave empty to use globally, or select specific projects, goals, or jobs.
            </p>
            <ScopeMultiSelect
              projects={projects}
              goals={goals}
              jobs={jobs}
              value={scopes}
              onChange={setScopes}
            />
          </div>
        </div>

        </div>

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
