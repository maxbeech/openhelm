import { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShieldAlert, AlertTriangle, Globe, Shield } from "lucide-react";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useProjectStore } from "@/stores/project-store";
import { ScopeMultiSelect } from "./scope-multi-select";
import { BrowserSetupStep } from "./browser-setup-step";
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
    allowBrowserInjection?: boolean;
    value: CredentialValue;
    scopes: CredentialScopeBinding[];
  }) => void | Promise<void | { id: string } | unknown>;
}

export function CredentialCreateDialog({ open, onOpenChange, projectId, onSave }: Props) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();

  const [name, setName] = useState("");
  const [type, setType] = useState<CredentialType>("username_password");
  const [injectionMode, setInjectionMode] = useState<"env" | "prompt" | "browser">("browser");
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopes, setScopes] = useState<CredentialScopeBinding[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Post-save browser setup step
  const [showBrowserSetup, setShowBrowserSetup] = useState(false);
  const [savedCredentialId, setSavedCredentialId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName(""); setType("username_password"); setInjectionMode("browser");
    setValue(""); setUsername(""); setPassword(""); setScopes([]); setSaveError(null);
    setShowBrowserSetup(false); setSavedCredentialId(null);
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

    setSaveError(null);
    try {
      const result = await onSave({
        name: name.trim(),
        type,
        allowPromptInjection: injectionMode === "prompt",
        allowBrowserInjection: injectionMode === "browser",
        value: credValue,
        scopes,
      });
      // For browser-only credentials, show the browser setup prompt
      if (injectionMode === "browser" && result && typeof result === "object" && "id" in result) {
        setSavedCredentialId((result as { id: string }).id);
        setShowBrowserSetup(true);
      } else {
        reset();
        onOpenChange(false);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create credential");
    } finally {
      setSaving(false);
    }
  }, [canSave, name, type, injectionMode, value, username, password, scopes, onSave, reset, onOpenChange]);

  const handleBrowserSetupComplete = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{showBrowserSetup ? "Set Up Browser Session" : "New Credential"}</DialogTitle>
        </DialogHeader>

        {showBrowserSetup && savedCredentialId ? (
          <BrowserSetupStep
            credentialId={savedCredentialId}
            onComplete={handleBrowserSetupComplete}
            onSkip={handleBrowserSetupComplete}
          />
        ) : (
          /* ── Normal credential form ── */
          <>
            <div className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {/* Name */}
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub API Token" />
                {name.trim() && (
                  <p className="mt-1 font-mono text-2xs text-muted-foreground">
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
                      {type === "token" && injectionMode === "browser" && (
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
              {saveError && <p className="mr-auto text-xs text-destructive">{saveError}</p>}
              <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!canSave || saving}>
                {saving ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
