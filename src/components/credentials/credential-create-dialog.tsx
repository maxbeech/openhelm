import { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, AlertTriangle } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useProjectStore } from "@/stores/project-store";
import { ScopeMultiSelect } from "./scope-multi-select";
import type { CredentialType, CredentialValue, CredentialScopeBinding } from "@openhelm/shared";

/**
 * Converts a credential name into an OPENHELM_* env var name preview.
 * Mirrors the logic in agent/src/credentials/env-var-name.ts.
 */
function previewEnvVarName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return `OPENHELM_${slug || "CREDENTIAL"}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSave: (data: {
    name: string;
    type: CredentialType;
    allowPromptInjection?: boolean;
    value: CredentialValue;
    scopes: CredentialScopeBinding[];
  }) => void | Promise<void>;
}

export function CredentialCreateDialog({ open, onOpenChange, projectId, onSave }: Props) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const [name, setName] = useState("");
  const [type, setType] = useState<CredentialType>("username_password");
  const [allowPromptInjection, setAllowPromptInjection] = useState(false);
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopes, setScopes] = useState<CredentialScopeBinding[]>([]);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setName(""); setType("username_password"); setAllowPromptInjection(false);
    setValue(""); setUsername(""); setPassword(""); setScopes([]);
  }, []);

  const envVarPreview = useMemo(() => previewEnvVarName(name), [name]);

  const canSave = name.trim() &&
    (type !== "username_password" ? value.trim() : (username.trim() && password.trim()));

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const credValue: CredentialValue = type === "username_password"
      ? { type: "username_password", username, password }
      : { type: "token", value };

    try {
      await onSave({ name: name.trim(), type, allowPromptInjection, value: credValue, scopes });
    } finally {
      reset();
      setSaving(false);
      onOpenChange(false);
    }
  }, [canSave, name, type, allowPromptInjection, value, username, password, scopes, onSave, reset, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>New Credential</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
        <div className="space-y-4">
          {/* Risk notice — always shown */}
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-300">Credential Security Notice</p>
              <p className="text-xs text-amber-200/70">
                Values are encrypted in macOS Keychain. However, OpenHelm cannot fully control how Claude Code
                handles credentials at runtime. Claude Code may read environment variables via shell commands.
                You use this feature at your own risk.
              </p>
            </div>
          </div>

          {/* Name */}
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub API Token" />
            {name.trim() && (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                Env var: <span className="text-foreground/70">{envVarPreview}</span>
                {type === "username_password" && (
                  <span className="text-muted-foreground/60"> / {envVarPreview}_USERNAME / {envVarPreview}_PASSWORD</span>
                )}
              </p>
            )}
          </div>

          {/* Type */}
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CredentialType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="username_password">Username &amp; Password</SelectItem>
                <SelectItem value="token">Token / API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Value fields */}
          {type === "username_password" ? (
            <div className="space-y-2">
              <div>
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <Label>Value</Label>
              <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}

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
                    Credential will be set as an environment variable only. The value is{" "}
                    <strong>not automatically sent to Anthropic</strong>, but Claude Code can still read it via
                    shell commands (e.g. <code className="text-[10px]">echo $VAR</code>).
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
              Leave empty to use globally across all projects, or select specific projects, goals, or jobs.
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
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
