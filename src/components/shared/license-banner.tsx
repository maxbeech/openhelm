import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import * as api from "@/lib/api";
import { open } from "@tauri-apps/plugin-shell";
import type { LicenseStatus } from "@openhelm/shared";

interface LicenseBannerProps {
  licenseStatus: LicenseStatus;
}

const LAPSED_STATUSES = new Set(["canceled", "past_due", "unpaid"]);

/** Returns true if the banner should be shown */
export function shouldShowLicenseBanner(status: LicenseStatus): boolean {
  if (status.tier !== "business") return false;
  if (!status.stripeSubscriptionStatus) return false;
  if (!LAPSED_STATUSES.has(status.stripeSubscriptionStatus)) return false;
  return !status.isValid; // isValid accounts for grace period
}

export function LicenseBanner({ licenseStatus }: LicenseBannerProps) {
  const [opening, setOpening] = useState(false);

  const handleManage = async () => {
    setOpening(true);
    try {
      const portal = await api.createPortalSession();
      await open(portal.url);
    } catch {
      // Silently ignore — user can try from settings
    } finally {
      setOpening(false);
    }
  };

  const statusLabel: Record<string, string> = {
    canceled: "has been cancelled",
    past_due: "payment is past due",
    unpaid: "has an unpaid invoice",
  };

  const label =
    statusLabel[licenseStatus.stripeSubscriptionStatus ?? ""] ??
    "has an issue";

  return (
    <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-700 dark:text-yellow-400">
      <AlertTriangle className="size-3 shrink-0" />
      <span>Your Business subscription {label}.</span>
      <Button
        size="xs"
        variant="outline"
        className="h-6 border-yellow-500/40 px-2 text-xs text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-400"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleManage}
        disabled={opening}
      >
        {opening ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <><ExternalLink className="mr-1 size-3" />Manage</>
        )}
      </Button>
    </div>
  );
}
