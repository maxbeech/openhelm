/**
 * InstallProgressStep — shown after an MCP or CLI connection is created.
 *
 * Handles:
 *   1. Streaming install output (via agent:connection.installProgress events).
 *   2. Post-install authentication:
 *      - MCP: token-paste (or full OAuth when an OAuth config is registered).
 *      - CLI: device-code / browser / token-paste via startCliAuth → polling.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle2, AlertCircle, Loader2, ExternalLink, Key, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAgentEvent } from "@/hooks/use-agent-event";
import * as api from "@/lib/api";
import { open as openUrl } from "@tauri-apps/plugin-shell";

interface InstallProgressEvent {
  connectionId: string;
  status: "installing" | "installed" | "failed";
  message: string;
}

interface AuthProgressEvent {
  connectionId: string;
  message: string;
}

export interface InstallProgressStepProps {
  connectionId: string;
  connectionType: "mcp" | "cli";
  onDone: () => void;
  onCancel: () => void;
  /** Skip straight to auth if install already succeeded. Default: "installing". */
  initialPhase?: Phase;
}

type Phase =
  | "installing"
  | "install_failed"
  | "auth_pending"
  | "auth_running"
  | "token_paste"
  | "auth_done";

export function InstallProgressStep({
  connectionId,
  connectionType,
  onDone,
  onCancel,
  initialPhase = "installing",
}: InstallProgressStepProps) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [logs, setLogs] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<"device_code" | "browser" | "token_paste" | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [authInstructions, setAuthInstructions] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const appendLog = useCallback((msg: string) => {
    setLogs((prev) => {
      const next = [...prev, msg];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  useAgentEvent<InstallProgressEvent>("connection.installProgress", (data) => {
    if (data.connectionId !== connectionId) return;
    appendLog(data.message);
    if (data.status === "installed") {
      setPhase("auth_pending");
    } else if (data.status === "failed") {
      setInstallError(data.message);
      setPhase("install_failed");
    }
  });

  useAgentEvent<AuthProgressEvent>("connection.authProgress", (data) => {
    if (data.connectionId !== connectionId) return;
    if (data.message === "Authentication complete") {
      clearPolling();
      setPhase("auth_done");
    }
  });

  // Also listen for connection updates (e.g. setToken marks as authenticated)
  useAgentEvent<{ id: string; authStatus: string }>("connection.updated", (data) => {
    if (data.id !== connectionId) return;
    if (data.authStatus === "authenticated" && phase === "token_paste") {
      setPhase("auth_done");
    }
  });

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPolling(), [clearPolling]);

  const startCliAuthFlow = useCallback(async () => {
    setPhase("auth_running");
    try {
      const result = await api.startCliAuth(connectionId);
      const method = result.method as "device_code" | "browser" | "token_paste";
      setAuthMethod(method);
      setDeviceCode(result.deviceCode ?? null);
      setVerificationUrl(result.verificationUrl ?? null);
      setAuthInstructions(result.instructions ?? null);

      if (method === "token_paste") {
        setPhase("token_paste");
        return;
      }

      if (result.verificationUrl) {
        openUrl(result.verificationUrl).catch(() => {});
      }

      pollingRef.current = setInterval(async () => {
        try {
          const done = await api.completeCliAuth(connectionId);
          if (done.authenticated) {
            clearPolling();
            setPhase("auth_done");
          } else if (done.timedOut) {
            clearPolling();
            setPhase("auth_pending");
          }
        } catch {
          // transient error — keep polling
        }
      }, 3_000);
    } catch {
      setPhase("auth_pending");
    }
  }, [connectionId, clearPolling]);

  const startMcpAuthFlow = useCallback(async () => {
    try {
      const oauthInfo = await api.getMcpOauthConfig(connectionId);
      if (oauthInfo.oauthRequired && oauthInfo.config?.clientId) {
        const result = await api.startMcpOauth({
          connectionId,
          authorizationEndpoint: oauthInfo.config.authorizationEndpoint,
          clientId: oauthInfo.config.clientId,
          redirectUri: oauthInfo.config.redirectUri,
          scope: oauthInfo.config.scope,
          tokenEndpoint: oauthInfo.config.tokenEndpoint,
        });
        setVerificationUrl(result.authorizationUrl);
        setAuthMethod("browser");
        setPhase("auth_running");
        openUrl(result.authorizationUrl).catch(() => {});
      } else {
        setPhase("token_paste");
      }
    } catch {
      setPhase("token_paste");
    }
  }, [connectionId]);

  const handleStartAuth = useCallback(() => {
    if (connectionType === "cli") return startCliAuthFlow();
    return startMcpAuthFlow();
  }, [connectionType, startCliAuthFlow, startMcpAuthFlow]);

  const handleSaveToken = useCallback(async () => {
    if (!token.trim()) return;
    setSavingToken(true);
    setTokenError(null);
    try {
      await api.setConnectionToken(connectionId, token.trim());
      setPhase("auth_done");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setSavingToken(false);
    }
  }, [connectionId, token]);

  const handleRetryInstall = useCallback(async () => {
    setRetrying(true);
    setLogs([]);
    setInstallError(null);
    setPhase("installing");
    try {
      await api.reinstallConnection(connectionId);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Failed to retry install");
      setPhase("install_failed");
    } finally {
      setRetrying(false);
    }
  }, [connectionId]);

  return (
    <div className="space-y-4">
      {/* Log panel — visible during and after install */}
      {logs.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded border border-border bg-muted/40 p-2.5">
          {logs.map((line, i) => (
            <p key={i} className="font-mono text-2xs text-muted-foreground">{line}</p>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Status areas */}
      {phase === "installing" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {logs.length === 0 ? "Preparing installation..." : "Installing..."}
        </div>
      )}

      {phase === "install_failed" && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-red-400">
            <AlertCircle className="size-4 shrink-0" />
            Installation failed
          </div>
          {installError && <p className="text-2xs text-muted-foreground">{installError}</p>}
          <Button size="sm" variant="outline" onClick={handleRetryInstall} disabled={retrying}>
            <RefreshCw className={`mr-1.5 size-3.5 ${retrying ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      )}

      {phase === "auth_pending" && (
        <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4 shrink-0 text-green-400" />
            Installed — connect your account
          </div>
          <p className="text-2xs text-muted-foreground">
            {connectionType === "mcp"
              ? "Add your API token so jobs can use this MCP server."
              : "Run the authentication flow to link your account."}
          </p>
          <Button size="sm" onClick={handleStartAuth}>
            {connectionType === "mcp" ? (
              <><Key className="mr-1.5 size-3.5" />Add Token</>
            ) : (
              "Authenticate"
            )}
          </Button>
        </div>
      )}

      {phase === "auth_running" && connectionType === "cli" && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Waiting for authentication...
          </div>
          {deviceCode && (
            <div className="space-y-1">
              <p className="text-2xs text-muted-foreground">Enter this code when prompted:</p>
              <code className="block rounded bg-muted px-2 py-1.5 text-sm font-mono font-bold tracking-widest">
                {deviceCode}
              </code>
            </div>
          )}
          {verificationUrl && (
            <button
              onClick={() => openUrl(verificationUrl).catch(() => {})}
              className="flex items-center gap-1 text-2xs text-primary underline underline-offset-2"
            >
              <ExternalLink className="size-3 shrink-0" />
              Open browser
            </button>
          )}
          {authInstructions && (
            <p className="whitespace-pre-wrap text-2xs text-muted-foreground">{authInstructions}</p>
          )}
        </div>
      )}

      {phase === "auth_running" && connectionType === "mcp" && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Complete authorization in your browser
          </div>
          {verificationUrl && (
            <button
              onClick={() => openUrl(verificationUrl).catch(() => {})}
              className="flex items-center gap-1 text-2xs text-primary underline underline-offset-2"
            >
              <ExternalLink className="size-3 shrink-0" />
              Re-open authorization URL
            </button>
          )}
        </div>
      )}

      {phase === "token_paste" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Key className="size-4 shrink-0 text-primary" />
            {connectionType === "mcp" ? "Add your API token" : "Paste your token"}
          </div>
          <p className="text-2xs text-muted-foreground">
            {connectionType === "mcp"
              ? "Paste your API key or personal access token. It will be stored in your Keychain and injected into jobs that use this connection."
              : "Paste your token to complete authentication."}
          </p>
          <div className="space-y-2">
            <Label>Token</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your token here..."
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveToken(); }}
              autoFocus
            />
          </div>
          {tokenError && <p className="text-xs text-destructive">{tokenError}</p>}
          <Button
            size="sm"
            onClick={handleSaveToken}
            disabled={!token.trim() || savingToken}
          >
            {savingToken ? "Saving..." : "Save Token"}
          </Button>
        </div>
      )}

      {phase === "auth_done" && (
        <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/5 p-3 text-sm font-medium text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Connection ready
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {phase === "auth_done" ? "Close" : "Cancel"}
        </Button>
        {phase === "auth_done" && (
          <Button size="sm" onClick={onDone}>Done</Button>
        )}
      </div>
    </div>
  );
}
