import { useState, useEffect, useCallback } from "react";
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
import type { Credential, CredentialScope, CredentialValue } from "@openhelm/shared";

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
    scopeType?: CredentialScope;
    scopeId?: string;
    isEnabled?: boolean;
  }) => void;
}

export function CredentialEditDialog({ open, onOpenChange, credential, projectId, onSave }: Props) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const [name, setName] = useState("");
  const [allowPromptInjection, setAllowPromptInjection] = useState(false);
  const [updateValue, setUpdateValue] = useState(false);
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopeType, setScopeType] = useState<CredentialScope>("global");
  const [scopeId, setScopeId] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (credential) {
      setName(credential.name);
      setAllowPromptInjection(credential.allowPromptInjection);
      setScopeType(credential.scopeType);
      setScopeId(credential.scopeId ?? "");
      setIsEnabled(credential.isEnabled);
      setUpdateValue(false);
      setValue("");
      setUsername("");
      setPassword("");
    }
  }, [credential]);

  const canSave = credential && name.trim() && (scopeType === "global" || scopeId);

  const handleSave = useCallback(async () => {
    if (!canSave || !credential) return;
    setSaving(true);

    let credValue: CredentialValue | undefined;
    if (updateValue) {
      credValue = credential.type === "username_password"
        ? { type: "username_password", username, password }
        : { type: "token", value };
    }

    onSave({
      id: credential.id,
      name: name.trim(),
      allowPromptInjection,
      value: credValue,
      scopeType,
      scopeId: scopeType !== "global" ? scopeId : undefined,
      isEnabled,
    });
    setSaving(false);
    onOpenChange(false);
  }, [canSave, credential, name, allowPromptInjection, updateValue, value, username, password, scopeType, scopeId, isEnabled, onSave, onOpenChange]);

  if (!credential) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Credential</DialogTitle>
        </DialogHeader>

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

          {/* Update value */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Update Value</Label>
              <Switch checked={updateValue} onCheckedChange={setUpdateValue} />
            </div>
            {updateValue && (
              credential.type === "username_password" ? (
                <div className="space-y-2">
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
                </div>
              ) : (
                <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New value" />
              )
            )}
          </div>

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
                  <strong>sent to Anthropic's servers</strong>. Only enable if Claude Code needs to type or paste
                  the value directly.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 rounded-md border border-green-500/20 bg-green-500/5 p-2.5">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-green-400" />
                <p className="text-[11px] text-green-300/80">
                  Env var only — value is <strong>not automatically sent to Anthropic</strong>, but Claude Code
                  can still read it via shell commands.
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
