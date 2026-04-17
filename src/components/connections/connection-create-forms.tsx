import { useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Globe, Shield, FolderOpen } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScopeMultiSelect } from "../credentials/scope-multi-select";
import { BrowserSetupStep } from "../credentials/browser-setup-step";
import type { ConnectionScopeBinding, ConnectionType } from "@openhelm/shared";
import { useProjectStore } from "@/stores/project-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";

export type InjectionMode = "env" | "prompt" | "browser";

function previewEnvVarName(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  return `OPENHELM_${slug || "CONNECTION"}`;
}

interface CommonProps {
  name: string; setName: (v: string) => void;
  scopes: ConnectionScopeBinding[]; setScopes: (v: ConnectionScopeBinding[]) => void;
}

interface TokenFormProps extends CommonProps {
  value: string; setValue: (v: string) => void;
  injectionMode: InjectionMode; setInjectionMode: (v: InjectionMode) => void;
}

function ScopeSection({ scopes, setScopes }: Pick<CommonProps, "scopes" | "setScopes">) {
  const { projects } = useProjectStore();
  const { goals } = useGoalStore();
  const { jobs } = useJobStore();
  return (
    <div>
      <Label className="mb-2 block">Scope</Label>
      <p className="text-2xs text-muted-foreground mb-2">Leave empty for global access.</p>
      <ScopeMultiSelect projects={projects} goals={goals} jobs={jobs} value={scopes} onChange={setScopes} />
    </div>
  );
}

function InjectionModeRadio({ mode, setMode }: { mode: InjectionMode; setMode: (v: InjectionMode) => void }) {
  return (
    <div>
      <Label>Injection Mode</Label>
      <RadioGroup value={mode} onValueChange={(v) => setMode(v as InjectionMode)} className="mt-2 space-y-1.5">
        {[
          { value: "browser", icon: Globe, label: "Browser only", color: "text-green-400", badge: "Most secure" },
          { value: "env", icon: Shield, label: "Environment variable", color: "text-amber-400", badge: null },
          { value: "prompt", icon: ShieldAlert, label: "Prompt", color: "text-red-400", badge: "High risk" },
        ].map(({ value, icon: Icon, label, color, badge }) => (
          <label key={value} className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 transition-colors ${mode === value ? "border-primary/40 bg-primary/5" : "border-border"}`}>
            <RadioGroupItem value={value} />
            <Icon className={`size-3.5 ${color}`} />
            <span className="text-xs font-medium">{label}</span>
            {badge && <span className={`rounded px-1.5 py-0.5 text-3xs font-medium ${value === "browser" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>{badge}</span>}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function TokenForm({ name, setName, value, setValue, injectionMode, setInjectionMode, scopes, setScopes }: TokenFormProps) {
  const envVarPreview = useMemo(() => previewEnvVarName(name), [name]);
  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub API Token" />
        {name.trim() && <p className="mt-1 font-mono text-2xs text-muted-foreground">Env var: {envVarPreview}</p>}
      </div>
      <div>
        <Label>Value</Label>
        <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Token / API key" />
      </div>
      <InjectionModeRadio mode={injectionMode} setMode={setInjectionMode} />
      <ScopeSection scopes={scopes} setScopes={setScopes} />
    </div>
  );
}

interface PlainTextFormProps extends CommonProps {
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
}

export function PlainTextForm({ name, setName, username, setUsername, password, setPassword, scopes, setScopes }: PlainTextFormProps) {
  return (
    <div className="space-y-4">
      <div className="rounded border border-orange-500/40 bg-orange-500/10 p-2.5">
        <p className="text-2xs text-orange-200">
          <span className="font-semibold">High risk:</span> plain-text credentials are injected directly into the run prompt. Use only when no MCP, CLI, Browser, or Token option exists for this service.
        </p>
      </div>
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Database Credentials" />
      </div>
      <div className="space-y-2">
        <Label>Username <span className="text-2xs text-muted-foreground">(optional)</span></Label>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        <Label>Password</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <ScopeSection scopes={scopes} setScopes={setScopes} />
    </div>
  );
}

interface BrowserFormProps extends CommonProps {
  savedConnectionId: string | null;
  onBrowserSetupComplete: () => void;
}

export function BrowserForm({ name, setName, scopes, setScopes, savedConnectionId, onBrowserSetupComplete }: BrowserFormProps) {
  if (savedConnectionId) {
    return <BrowserSetupStep connectionId={savedConnectionId} onComplete={onBrowserSetupComplete} onSkip={onBrowserSetupComplete} />;
  }
  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub Browser Session" />
      </div>
      <ScopeSection scopes={scopes} setScopes={setScopes} />
      <p className="text-2xs text-muted-foreground rounded border border-border p-2">
        After creating, you&apos;ll be guided to set up a browser session so credentials are captured securely.
      </p>
    </div>
  );
}

export function FolderForm({ name, setName, scopes, setScopes, folderPath, setFolderPath }: CommonProps & { folderPath: string; setFolderPath: (v: string) => void }) {
  const handleBrowse = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setFolderPath(selected);
  }, [setFolderPath]);

  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project Workspace" />
      </div>
      <div>
        <Label>Folder Path</Label>
        <div className="flex gap-2">
          <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/Users/me/projects/my-project" className="flex-1" />
          <Button type="button" variant="outline" size="icon" onClick={handleBrowse} title="Browse for folder">
            <FolderOpen className="size-4" />
          </Button>
        </div>
      </div>
      <ScopeSection scopes={scopes} setScopes={setScopes} />
    </div>
  );
}

export function McpForm({ name, setName, scopes, setScopes, mcpServerId, setMcpServerId }: CommonProps & { mcpServerId: string; setMcpServerId: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Notion MCP" />
      </div>
      <div>
        <Label>MCP Server ID</Label>
        <Input value={mcpServerId} onChange={(e) => setMcpServerId(e.target.value)} placeholder="e.g. io.github.example/my-server" />
        <p className="mt-1 text-2xs text-muted-foreground">Package name or registry ID for the MCP server.</p>
      </div>
      <ScopeSection scopes={scopes} setScopes={setScopes} />
    </div>
  );
}

export function CliForm({ name, setName, scopes, setScopes, cliId, setCliId }: CommonProps & { cliId: string; setCliId: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub CLI" />
      </div>
      <div>
        <Label>CLI ID</Label>
        <Input value={cliId} onChange={(e) => setCliId(e.target.value)} placeholder="e.g. gh" />
        <p className="mt-1 text-2xs text-muted-foreground">CLI tool identifier (gh, supabase, vercel, etc.)</p>
      </div>
      <ScopeSection scopes={scopes} setScopes={setScopes} />
    </div>
  );
}
