import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, AlertTriangle, Globe, Shield } from "lucide-react";
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
    allowBrowserInjection?: boolean;
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
  const [injectionMode, setInjectionMode] = useState<"env" | "prompt" | "browser">("env");
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopes, setScopes] = useState<CredentialScopeBinding[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (credential) {
      setName(credential.name);
      // Derive injection mode from the two boolean fields
      if (credential.allowBrowserInjection) {
        setInjectionMode("browser");
      } else if (credential.allowPromptInjection) {
        setInjectionMode("prompt");
      } else {
        setInjectionMode("env");
      }
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
    setSaveError(null);

    // Only send value if the user typed something new.
    // For username_password, require BOTH fields — a partial update would blank the other field.
    let credValue: CredentialValue | undefined;
    if (credential.type === "username_password") {
      if (username.trim() && password.trim()) {
        credValue = { type: "username_password", username, password };
      } else if (username.trim() || password.trim()) {
        setSaveError("Please fill in both username and password to update credentials.");
        setSaving(false);
        return;
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
        allowPromptInjection: injectionMode === "prompt",
        allowBrowserInjection: injectionMode === "browser",
        value: credValue,
        scopes,
        isEnabled,
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save credential");
    } finally {
      setSaving(false);
    }
  }, [canSave, credential, name, injectionMode, value, username, password, scopes, isEnabled, onSave, onOpenChange]);

  if (!credential) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit Credential</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
        <div className="space-y-4">
          {/* Name */}
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 font-mono text-2xs text-muted-foreground">
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
            <p className="text-2xs text-muted-foreground mb-1.5">
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

          {/* Injection mode */}
          <div className="space-y-2">
            <Label>Injection Mode</Label>
            <RadioGroup value={injectionMode} onValueChange={(v) => setInjectionMode(v as "env" | "prompt" | "browser")}>

              {/* Browser only — safest */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${injectionMode === "browser" ? "border-green-500/40 bg-green-500/5" : "border-border"}`}>
                <RadioGroupItem value="browser" className="mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Globe className="size-3.5 text-green-400" />
                    <span className="text-xs font-medium">Browser only</span>
                    <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-3xs font-medium text-green-300">Most secure</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Injected directly into the browser (login forms, cookies, auth headers). Claude Code{" "}
                    <strong className="text-green-300/80">never sees the value</strong> — not accessible in the terminal
                    or prompt. Values are encrypted in macOS Keychain.
                  </p>
                  {credential.type === "token" && injectionMode === "browser" && (
                    <div className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-400" />
                      <p className="text-2xs text-amber-200/80">
                        Whilst this is the securest mode, tokens and API keys typically need to be accessible in the
                        terminal. Browser only won&apos;t work for most token/API key use cases.
                      </p>
                    </div>
                  )}
                </div>
              </label>

              {/* Env only — medium risk */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${injectionMode === "env" ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
                <RadioGroupItem value="env" className="mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Shield className="size-3.5 text-amber-400" />
                    <span className="text-xs font-medium">Environment variable</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Set as an environment variable — also accessible in the browser. Claude Code can read the value
                    via shell commands. Value is{" "}
                    <strong className="text-green-300/80">not sent to Anthropic</strong>.
                    OpenHelm cannot fully control how Claude Code handles credentials at runtime.
                  </p>
                </div>
              </label>

              {/* Prompt — high risk */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${injectionMode === "prompt" ? "border-red-500/40 bg-red-500/5" : "border-border"}`}>
                <RadioGroupItem value="prompt" className="mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="size-3.5 text-red-400" />
                    <span className="text-xs font-medium">Prompt</span>
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-3xs font-medium text-red-300">High risk</span>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    Credential is injected directly into the prompt text — also set as an env variable and accessible
                    in the browser.{" "}
                    <strong className="text-red-300/80">Value is explicitly sent to Anthropic&apos;s servers</strong>{" "}
                    as part of every conversation. Only use this if the task absolutely requires the credential in prompt context.
                  </p>
                </div>
              </label>

            </RadioGroup>
          </div>

          {/* Scope */}
          <div>
            <Label className="mb-2 block">Scope</Label>
            <p className="text-2xs text-muted-foreground mb-2">
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
          {saveError && <p className="mr-auto text-xs text-destructive">{saveError}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
