import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Chrome, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useAgentEvent } from "@/hooks/use-agent-event";
import {
  setupBrowserProfile,
  finalizeBrowserProfile,
  cancelBrowserSetup,
} from "@/lib/api";
import { isCloudMode } from "@/lib/mode";
import type { BrowserSetupStatus, BrowserSessionVerification } from "@openhelm/shared";

interface Props {
  /** @deprecated Use connectionId */
  credentialId?: string;
  connectionId?: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function BrowserSetupStep({ credentialId, connectionId, onComplete, onSkip }: Props) {
  const id = connectionId ?? credentialId ?? "";
  const [status, setStatus] = useState<BrowserSetupStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const sandboxIdRef = useRef<string | null>(null);

  // Local (Tauri) mode events — cloud drives state directly via the finalize RPC.
  useAgentEvent<{ connectionId?: string; credentialId?: string }>("credential.browserLaunched", (d) => {
    if ((d.connectionId ?? d.credentialId) === id) setStatus("browser_open");
  });
  useAgentEvent<{ connectionId?: string; credentialId?: string }>("credential.browserClosed", (d) => {
    if ((d.connectionId ?? d.credentialId) === id) setStatus("verifying");
  });
  useAgentEvent<BrowserSessionVerification>("credential.sessionVerified", (d) => {
    if ((d.connectionId ?? d.credentialId) !== id) return;
    setStatus(d.status === "likely_logged_in" ? "completed" : "no_login_detected");
  });

  // Cancel monitor / sandbox on unmount if still open
  useEffect(() => {
    return () => {
      if (status === "browser_open" || status === "verifying") {
        if (isCloudMode && sandboxIdRef.current) {
          cancelBrowserSetup({ sandboxId: sandboxIdRef.current }).catch(() => {});
        } else {
          cancelBrowserSetup(id).catch(() => {});
        }
      }
    };
  }, [id, status]);

  const handleLaunch = useCallback(async () => {
    setStatus("launching");
    setError(null);
    try {
      const result = await setupBrowserProfile({ connectionId: id });
      if (!result.launched) {
        setStatus("error");
        setError(result.message);
        return;
      }
      if (isCloudMode) {
        // Cloud: we have a sandbox + stream URL. Show the iframe immediately;
        // the user will click Done to finalize.
        sandboxIdRef.current = result.sandboxId ?? null;
        setStreamUrl(result.streamUrl ?? null);
        setStatus("browser_open");
      }
      // Local: the credential.browserLaunched agent event transitions us.
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to launch browser");
    }
  }, [id]);

  const handleCloudFinalize = useCallback(async () => {
    if (!sandboxIdRef.current) return;
    setStatus("verifying");
    try {
      const result = await finalizeBrowserProfile({
        sandboxId: sandboxIdRef.current,
      });
      setStatus(result.status === "likely_logged_in" ? "completed" : "no_login_detected");
      sandboxIdRef.current = null;
      setStreamUrl(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to save login session");
    }
  }, []);

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setError(null);
    setStreamUrl(null);
    sandboxIdRef.current = null;
  }, []);

  return (
    <>
      <div className="flex-1 space-y-4 px-1">
        {status === "idle" && (
          <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
            <Chrome className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Log in once to save your session</p>
              <p className="text-2xs text-muted-foreground">
                {isCloudMode
                  ? "We'll open a remote browser embedded in this window so you can log in. Your session is saved and reused for future automation runs."
                  : "We'll open Chrome so you can log in manually. Your session will be saved and reused automatically for future automation runs."}
              </p>
            </div>
          </div>
        )}

        {status === "launching" && (
          <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <Loader2 className="size-5 shrink-0 animate-spin text-blue-400" />
            <p className="text-sm font-medium">
              {isCloudMode ? "Starting remote browser..." : "Opening Chrome..."}
            </p>
          </div>
        )}

        {status === "browser_open" && isCloudMode && streamUrl && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border border-blue-500/30">
              <iframe
                src={streamUrl}
                title="Remote browser"
                className="block h-[520px] w-full bg-black"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              />
            </div>
            <p className="text-2xs text-muted-foreground">
              Log in in the remote browser above. When done, click <strong>Done — Save Login</strong>.
            </p>
          </div>
        )}
        {status === "browser_open" && !isCloudMode && (
          <div className="flex items-start gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="relative mt-1 shrink-0">
              <Chrome className="size-5 text-blue-400" />
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Chrome is open</p>
              <p className="text-2xs text-muted-foreground">
                Log in in the Chrome window, then <strong>quit Chrome (⌘Q)</strong>. We&apos;ll detect your session.
              </p>
            </div>
          </div>
        )}

        {status === "verifying" && (
          <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <Loader2 className="size-5 shrink-0 animate-spin text-blue-400" />
            <p className="text-sm font-medium">Checking session...</p>
          </div>
        )}

        {status === "completed" && (
          <div className="flex items-start gap-3 rounded-md border border-green-500/30 bg-green-500/5 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Session saved successfully</p>
              <p className="text-2xs text-muted-foreground">
                Your login session has been saved. It will be used automatically in future
                automation runs that use this credential.
              </p>
            </div>
          </div>
        )}

        {status === "no_login_detected" && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">No login detected</p>
              <p className="text-2xs text-muted-foreground">
                The browser was closed but we couldn&apos;t detect a login session. If you didn&apos;t
                log in, try again. If you did log in, it may still work — some sites store
                sessions differently.
              </p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Something went wrong</p>
              {error && <p className="text-2xs text-muted-foreground">{error}</p>}
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="shrink-0">
        {status === "idle" && (
          <>
            <Button variant="ghost" onClick={onSkip}>Skip for Now</Button>
            <Button onClick={handleLaunch}>Open Browser</Button>
          </>
        )}
        {status === "browser_open" && isCloudMode && (
          <Button onClick={handleCloudFinalize}>Done — Save Login</Button>
        )}
        {status === "browser_open" && !isCloudMode && (
          <Button variant="ghost" onClick={onComplete}>Done</Button>
        )}
        {status === "completed" && (
          <Button onClick={onComplete}>Done</Button>
        )}
        {(status === "no_login_detected" || status === "error") && (
          <>
            <Button variant="ghost" onClick={onSkip}>Skip</Button>
            <Button onClick={handleRetry}>Try Again</Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
