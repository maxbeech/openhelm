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
import type { CredentialType, CredentialScope, CredentialValue } from "@openhelm/shared";

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
    scopeType: CredentialScope;
    scopeId?: string;
  }) => void;
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
  const [scopeType, setScopeType] = useState<CredentialScope>("global");
  const [scopeId, setScopeId] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setName(""); setType("username_password"); setAllowPromptInjection(false);
    setValue(""); setUsername(""); setPassword(""); setScopeType("global"); setScopeId("");
  }, []);

  const envVarPreview = useMemo(() => previewEnvVarName(name), [name]);

  const canSave = name.trim() &&
    (type !== "username_password" ? value.trim() : (username.trim() && password.trim())) &&
    (scopeType === "global" || scopeId);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const credValue: CredentialValue = type === "username_password"
      ? { type: "username_password", username, password }
      : { type: "token", value };

    onSave({
      name: name.trim(),
      type,
      allowPromptInjection,
      value: credValue,
      scopeType,
      scopeId: scopeType !== "global" ? scopeId : undefined,
    });
    reset();
    setSaving(false);
    onOpenChange(false);
  }, [canSave, name, type, allowPromptInjection, value, username, password, scopeType, scopeId, onSave, reset, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Credential</DialogTitle>
        </DialogHeader>

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
                  Also inject credential value into prompt context
                </p>
              </div>
              <Switch checked={allowPromptInjection} onCheckedChange={setAllowPromptInjection} />
            </div>
            {allowPromptInjection ? (
              <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                <p className="text-[11px] text-red-300/80">
                  <strong>Elevated risk:</strong> The credential value will be included in the prompt text and{" "}
                  <strong>sent to Anthropic's servers</strong>. Enable at your own risk if Claude Code needs to
                  type or paste the value directly.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 rounded-md border border-green-500/20 bg-green-500/5 p-2.5">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-green-400" />
                <p className="text-[11px] text-green-300/80">
                  Credential will be set as an environment variable only. The value is{" "}
                  <strong>not automatically sent to Anthropic</strong>, but Claude Code can still read it via
                  shell commands (e.g. <code className="text-[10px]">echo $VAR</code>).
                </p>
              </div>
            )}
          </div>

          {/* Scope */}
          <div>
            <Label className="mb-2 block">Scope</Label>
            <Select value={scopeType} onValueChange={(v) => { setScopeType(v as CredentialScope); setScopeId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">All Projects</SelectItem>
                <SelectItem value="project">Specific Project</SelectItem>
                <SelectItem value="goal">Specific Goal</SelectItem>
                <SelectItem value="job">Specific Job</SelectItem>
              </SelectContent>
            </Select>
            {scopeType === "project" && (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Choose project..." /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {scopeType === "goal" && (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Choose goal..." /></SelectTrigger>
                <SelectContent>
                  {goals.filter((g) => !projectId || g.projectId === projectId).map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {scopeType === "job" && (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Choose job..." /></SelectTrigger>
                <SelectContent>
                  {jobs.filter((j) => !projectId || j.projectId === projectId).map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
