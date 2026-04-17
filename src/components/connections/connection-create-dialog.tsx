import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Folder } from "lucide-react";
import { isLocalMode } from "@/lib/mode";
import { useConnectionStore } from "@/stores/connection-store";
import type {
  ConnectionType,
  ConnectionScopeBinding,
  ConnectionValue,
  ConnectionConfig,
  FolderConfig,
  BrowserConfig,
} from "@openhelm/shared";
import {
  TokenForm,
  PlainTextForm,
  BrowserForm,
  FolderForm,
  McpForm,
  CliForm,
  type InjectionMode,
} from "./connection-create-forms";
import { ServiceSearchInput, type SelectedService } from "./service-search-input";
import { ServiceConnectionTypePicker } from "./service-connection-type-picker";
import { InstallProgressStep } from "./install-progress-step";

interface CreateParams {
  name: string; type: ConnectionType;
  value?: ConnectionValue; config?: ConnectionConfig;
  allowPromptInjection?: boolean; allowBrowserInjection?: boolean;
  scopes: ConnectionScopeBinding[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: CreateParams) => Promise<{ id: string } | void | unknown>;
}

type Step = "search" | "type" | "form" | "install";

export function ConnectionCreateDialog({ open, onOpenChange, onSave }: Props) {
  const { installMcp, installCli } = useConnectionStore();
  const [step, setStep] = useState<Step>("search");
  const [service, setService] = useState<SelectedService | null>(null);
  const [selectedType, setSelectedType] = useState<ConnectionType | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedConnectionId, setSavedConnectionId] = useState<string | null>(null);

  const [directToForm, setDirectToForm] = useState(false);

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [injectionMode, setInjectionMode] = useState<InjectionMode>("env");
  const [scopes, setScopes] = useState<ConnectionScopeBinding[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [mcpServerId, setMcpServerId] = useState("");
  const [cliId, setCliId] = useState("");

  const reset = useCallback(() => {
    setStep("search");
    setService(null);
    setSelectedType(null);
    setDirectToForm(false);
    setSaving(false); setSaveError(null); setSavedConnectionId(null);
    setName(""); setValue(""); setUsername(""); setPassword(""); setInjectionMode("env");
    setScopes([]); setFolderPath(""); setMcpServerId(""); setCliId("");
  }, []);

  const handleSelectService = useCallback((s: SelectedService) => {
    setService(s);
    setName(s.displayName);
    if (s.mcpServerId) setMcpServerId(s.mcpServerId);
    if (s.entry?.cliId) setCliId(s.entry.cliId);
    setStep("type");
  }, []);

  const handlePickType = useCallback((t: ConnectionType) => {
    setSelectedType(t);
    setStep("form");
  }, []);

  const handleOpenFolder = useCallback(() => {
    setService({ entry: null, displayName: "Local Folder", isCustom: true });
    setSelectedType("folder");
    setName("");
    setDirectToForm(true);
    setStep("form");
  }, []);

  const handleBack = useCallback(() => {
    if (step === "install") { setStep("form"); setSavedConnectionId(null); return; }
    if (step === "form") { setSelectedType(null); setStep(directToForm || !service ? "search" : "type"); return; }
    if (step === "type") { setService(null); setStep("search"); return; }
  }, [step, service, directToForm]);

  const canSave = (() => {
    if (!name.trim() || !selectedType) return false;
    if (selectedType === "token") return !!value.trim();
    if (selectedType === "plain_text") return !!password.trim();
    if (selectedType === "folder") return !!folderPath.trim();
    if (selectedType === "mcp") return !!mcpServerId.trim();
    if (selectedType === "cli") return !!cliId.trim();
    return true; // browser
  })();

  const handleSave = useCallback(async () => {
    if (!canSave || !selectedType) return;
    setSaving(true); setSaveError(null);

    // MCP and CLI: kick off install flow, transition to install step.
    if (selectedType === "mcp") {
      try {
        const result = await installMcp({
          mcpServerId,
          name: name.trim() || undefined,
          installCommand: service?.mcpInstallCommand,
          scopes,
        });
        setSavedConnectionId(result.connectionId);
        setStep("install");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to start MCP installation");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (selectedType === "cli") {
      try {
        const result = await installCli(cliId, scopes);
        setSavedConnectionId(result.connectionId);
        setStep("install");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to start CLI installation");
      } finally {
        setSaving(false);
      }
      return;
    }

    // All other types: use the generic create path.
    let credValue: ConnectionValue | undefined;
    let config: ConnectionConfig | undefined;
    let allowPromptInjection = false;
    let allowBrowserInjection = false;

    if (selectedType === "token") {
      credValue = { type: "token", value };
      allowPromptInjection = injectionMode === "prompt";
      allowBrowserInjection = injectionMode === "browser";
    } else if (selectedType === "plain_text") {
      credValue = { type: "username_password", username, password };
      allowPromptInjection = true;
    } else if (selectedType === "browser") {
      allowBrowserInjection = true;
      const loginUrl = service?.entry?.domain ? `https://${service.entry.domain}` : undefined;
      config = { loginUrl } as BrowserConfig;
    } else if (selectedType === "folder") {
      config = { path: folderPath, isPrimary: false, projectId: "" } as FolderConfig;
    }

    try {
      const result = await onSave({
        name: name.trim(), type: selectedType,
        value: credValue, config,
        allowPromptInjection, allowBrowserInjection,
        scopes,
      });
      if (selectedType === "browser" && result && typeof result === "object" && "id" in result) {
        setSavedConnectionId((result as { id: string }).id);
      } else {
        reset();
        onOpenChange(false);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setSaving(false);
    }
  }, [
    canSave, selectedType, name, value, injectionMode, username, password,
    folderPath, mcpServerId, cliId, scopes, service, onSave, reset, onOpenChange,
    installMcp, installCli,
  ]);

  const title = (() => {
    if (step === "search") return "New Connection";
    if (step === "type") return service ? `Connect to ${service.displayName}` : "Choose connection";
    if (step === "install") return `Setting up ${service?.displayName ?? name}`;
    if (savedConnectionId) return "Set Up Browser Session";
    return service?.displayName ?? "New Connection";
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {step !== "search" && !savedConnectionId && (
              <button onClick={handleBack} className="rounded p-0.5 hover:bg-sidebar-accent">
                <ArrowLeft className="size-4" />
              </button>
            )}
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {step === "search" ? (
            <div className="space-y-4">
              <ServiceSearchInput onSelect={handleSelectService} />
              {isLocalMode && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-3xs uppercase text-muted-foreground">or</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <button
                    onClick={handleOpenFolder}
                    className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-sidebar-accent/50"
                  >
                    <Folder className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Add a local folder</p>
                      <p className="text-2xs text-muted-foreground">
                        Share a directory on this machine with your jobs.
                      </p>
                    </div>
                  </button>
                </>
              )}
            </div>
          ) : step === "install" && savedConnectionId ? (
            <InstallProgressStep
              connectionId={savedConnectionId}
              connectionType={selectedType as "mcp" | "cli"}
              onDone={() => { reset(); onOpenChange(false); }}
              onCancel={() => { reset(); onOpenChange(false); }}
            />
          ) : step === "type" && service ? (
            <ServiceConnectionTypePicker service={service} onPick={handlePickType} />
          ) : selectedType === "token" ? (
            <TokenForm name={name} setName={setName} value={value} setValue={setValue}
              injectionMode={injectionMode} setInjectionMode={setInjectionMode}
              scopes={scopes} setScopes={setScopes} />
          ) : selectedType === "plain_text" ? (
            <PlainTextForm name={name} setName={setName} username={username} setUsername={setUsername}
              password={password} setPassword={setPassword} scopes={scopes} setScopes={setScopes} />
          ) : selectedType === "browser" ? (
            <BrowserForm name={name} setName={setName} scopes={scopes} setScopes={setScopes}
              savedConnectionId={savedConnectionId} onBrowserSetupComplete={() => { reset(); onOpenChange(false); }} />
          ) : selectedType === "folder" ? (
            <FolderForm name={name} setName={setName} scopes={scopes} setScopes={setScopes}
              folderPath={folderPath} setFolderPath={setFolderPath} />
          ) : selectedType === "mcp" ? (
            <McpForm name={name} setName={setName} scopes={scopes} setScopes={setScopes}
              mcpServerId={mcpServerId} setMcpServerId={setMcpServerId} />
          ) : selectedType === "cli" ? (
            <CliForm name={name} setName={setName} scopes={scopes} setScopes={setScopes}
              cliId={cliId} setCliId={setCliId} />
          ) : null}
        </div>

        {step === "form" && !savedConnectionId && (
          <DialogFooter className="shrink-0">
            {saveError && <p className="mr-auto text-xs text-destructive">{saveError}</p>}
            <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving
                ? (selectedType === "mcp" || selectedType === "cli" ? "Installing..." : "Creating...")
                : (selectedType === "mcp" || selectedType === "cli" ? "Install" : "Create")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
