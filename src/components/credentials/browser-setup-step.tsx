import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Chrome, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useAgentEvent } from "@/hooks/use-agent-event";
import { setupBrowserProfile, cancelBrowserSetup } from "@/lib/api";
import type { BrowserSetupStatus, BrowserSessionVerification } from "@openhelm/shared";

interface Props {
  credentialId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function BrowserSetupStep({ credentialId, onComplete, onSkip }: Props) {
  const [status, setStatus] = useState<BrowserSetupStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Listen for agent events scoped to this credential
  useAgentEvent<{ credentialId: string }>(
    "credential.browserLaunched",
    (data) => {
      if (data.credentialId === credentialId) setStatus("browser_open");
    },
  );

  useAgentEvent<{ credentialId: string }>(
    "credential.browserClosed",
    (data) => {
      if (data.credentialId === credentialId) setStatus("verifying");
    },
  );

  useAgentEvent<BrowserSessionVerification>(
    "credential.sessionVerified",
    (data) => {
      if (data.credentialId !== credentialId) return;
      setStatus(data.status === "likely_logged_in" ? "completed" : "no_login_detected");
    },
  );

  // Cancel monitor on unmount if browser is still open
  useEffect(() => {
    return () => {
      if (status === "browser_open" || status === "verifying") {
        cancelBrowserSetup(credentialId).catch(() => {});
      }
    };
  }, [credentialId, status]);

  const handleLaunch = useCallback(async () => {
    setStatus("launching");
    setError(null);
    try {
      const result = await setupBrowserProfile({ credentialId });
      if (!result.launched) {
        setStatus("error");
        setError(result.message);
      }
      // The browserLaunched event will transition us to browser_open
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to launch browser");
    }
  }, [credentialId]);

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return (
    <>
      <div className="flex-1 space-y-4 px-1">
        {/* IDLE — explain + launch button */}
        {status === "idle" && (
          <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
            <Chrome className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Log in once to save your session</p>
              <p className="text-2xs text-muted-foreground">
                We&apos;ll open Chrome so you can log in manually. Your session will be saved
                and reused automatically for future automation runs.
              </p>
            </div>
          </div>
        )}

        {/* LAUNCHING */}
        {status === "launching" && (
          <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <Loader2 className="size-5 shrink-0 animate-spin text-blue-400" />
            <p className="text-sm font-medium">Opening Chrome...</p>
          </div>
        )}

        {/* BROWSER_OPEN — waiting for user to log in and close */}
        {status === "browser_open" && (
          <div className="flex items-start gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="relative mt-1 shrink-0">
              <Chrome className="size-5 text-blue-400" />
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Chrome is open</p>
              <p className="text-2xs text-muted-foreground">
                Log in to your site in the Chrome window. If Chrome asks to save your password, click <strong>Save</strong>.
                When you&apos;re done, <strong>quit Chrome (⌘Q)</strong> and we&apos;ll detect your session automatically.
              </p>
            </div>
          </div>
        )}

        {/* VERIFYING */}
        {status === "verifying" && (
          <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <Loader2 className="size-5 shrink-0 animate-spin text-blue-400" />
            <p className="text-sm font-medium">Checking session...</p>
          </div>
        )}

        {/* COMPLETED */}
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

        {/* NO_LOGIN_DETECTED */}
        {status === "no_login_detected" && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">No login detected</p>
              <p className="text-2xs text-muted-foreground">
                Chrome was closed but we couldn&apos;t detect a login session. If you didn&apos;t
                log in, try again. If you did log in, it may still work — some sites store
                sessions differently.
              </p>
            </div>
          </div>
        )}

        {/* ERROR */}
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
        {status === "browser_open" && (
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
