import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { LicenseStatus } from "@openhelm/shared";
import * as api from "@/lib/api";
import { open } from "@tauri-apps/plugin-shell";

export function LicenseSection() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [managingPortal, setManagingPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLicenseStatus()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async () => {
    if (!status?.email) {
      setError("No verified email found. Please complete onboarding first.");
      return;
    }
    setUpgrading(true);
    setError(null);
    try {
      const checkout = await api.createCheckoutSession({
        email: status.email,
        employeeCount: status.employeeCount ?? "4-10",
      });
      await open(checkout.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open checkout.");
    } finally {
      setUpgrading(false);
    }
  };

  const handleManagePortal = async () => {
    setManagingPortal(true);
    setError(null);
    try {
      const portal = await api.createPortalSession();
      await open(portal.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal.");
    } finally {
      setManagingPortal(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h3 className="mb-3 font-medium">License</h3>
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) return null;

  const isBusiness = status.tier === "business";
  const subStatusLabel: Record<string, string> = {
    active: "Active",
    trialing: "Free trial",
    past_due: "Past due",
    canceled: "Cancelled",
    unpaid: "Unpaid",
  };
  const subStatus = status.stripeSubscriptionStatus
    ? subStatusLabel[status.stripeSubscriptionStatus] ?? status.stripeSubscriptionStatus
    : null;

  const usageLabel: Record<string, string> = {
    personal: "Personal",
    education: "Educational",
    business: "Business",
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">License</h3>
      <div className="space-y-3 text-sm text-muted-foreground">
        {/* Tier badge */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-foreground">Plan</Label>
          <Badge variant={isBusiness ? "default" : "secondary"}>
            {isBusiness ? "Business" : "Community"}
          </Badge>
          {isBusiness && subStatus && (
            <Badge
              variant={
                status.stripeSubscriptionStatus === "active" ||
                status.stripeSubscriptionStatus === "trialing"
                  ? "outline"
                  : "destructive"
              }
              className="text-xs"
            >
              {subStatus}
            </Badge>
          )}
        </div>

        {/* Usage type */}
        {status.usageType && (
          <p>
            Usage:{" "}
            <span className="text-foreground">
              {usageLabel[status.usageType] ?? status.usageType}
            </span>
            {status.employeeCount && ` · ${status.employeeCount} team members`}
          </p>
        )}

        {/* Verified email */}
        {status.email && (
          <div className="flex items-center gap-1.5">
            {status.emailVerified ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : (
              <AlertCircle className="size-3.5 text-yellow-500" />
            )}
            <span>{status.email}</span>
            {!status.emailVerified && (
              <span className="text-xs text-yellow-600">(unverified)</span>
            )}
          </div>
        )}

        {/* Trial end */}
        {status.trialEndsAt && status.stripeSubscriptionStatus === "trialing" && (
          <p className="text-xs">
            Trial ends{" "}
            {new Date(status.trialEndsAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}

        {/* Error */}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Actions */}
        {!isBusiness && (
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ExternalLink className="size-3" />
              )}
              Upgrade to Business
            </Button>
          </div>
        )}

        {isBusiness && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleManagePortal}
            disabled={managingPortal}
          >
            {managingPortal ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ExternalLink className="size-3" />
            )}
            Manage subscription
          </Button>
        )}
      </div>
    </div>
  );
}
