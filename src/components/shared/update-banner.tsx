import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UpdaterStatus } from "@/hooks/use-updater";

interface UpdateBannerProps {
  status: UpdaterStatus;
  updateVersion: string | null;
  downloadProgress: number | null;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}

export function UpdateBanner({
  status,
  updateVersion,
  downloadProgress,
  error,
  onInstall,
  onDismiss,
  onRetry,
}: UpdateBannerProps) {
  if (status === "idle" || status === "not-available") {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
      {status === "available" && (
        <>
          <span className="text-muted-foreground">
            Update {updateVersion} available
          </span>
          <Button
            size="xs"
            className="h-6 px-2 text-xs"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onInstall}
          >
            Install &amp; Relaunch
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-xs"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onDismiss}
          >
            Later
          </Button>
        </>
      )}
      {status === "downloading" && (
        <>
          <span className="text-muted-foreground">Downloading…</span>
          <Progress
            value={downloadProgress ?? 0}
            className="h-1.5 w-24"
          />
          <span className="tabular-nums text-muted-foreground">
            {Math.round(downloadProgress ?? 0)}%
          </span>
        </>
      )}
      {status === "ready" && (
        <>
          <span className="text-muted-foreground">Update ready</span>
          <Button
            size="xs"
            className="h-6 px-2 text-xs"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onInstall}
          >
            Relaunch Now
          </Button>
        </>
      )}
      {status === "checking" && (
        <span className="text-muted-foreground">Checking for updates…</span>
      )}
      {status === "error" && (
        <>
          <span className="text-destructive">{error ?? "Update failed"}</span>
          <button
            className="text-muted-foreground underline hover:text-foreground"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onRetry}
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
