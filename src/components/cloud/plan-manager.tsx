/**
 * PlanManager — current plan display + Stripe Customer Portal access.
 *
 * The heavy lifting (plan selection, Stripe checkout) happens via the
 * Worker Service /rpc endpoint which creates Stripe Checkout and Portal sessions.
 *
 * Only rendered in cloud mode (caller must check isCloudMode).
 */

import { useEffect, useState } from "react";
import { Loader2, ExternalLink, CreditCard, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PlanSelector, type CloudPlan } from "./plan-selector";
import { getSupabaseClient, getWorkerUrl, getSession } from "@/lib/supabase-client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubscriptionState {
  plan: CloudPlan | null;
  status: "active" | "past_due" | "cancelled" | "trialing" | null;
  periodEnd: string | null;
  stripeCustomerId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function workerRpc<T>(method: string, params: unknown = {}): Promise<T> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${getWorkerUrl()}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ id: crypto.randomUUID(), method, params }),
  });

  if (!res.ok) throw new Error(`Worker RPC ${method} failed: HTTP ${res.status}`);
  const { result, error } = (await res.json()) as { id: string; result?: T; error?: { message: string } };
  if (error) throw new Error(error.message);
  return result as T;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "outline",
  past_due: "destructive",
  cancelled: "secondary",
};

// ── Component ──────────────────────────────────────────────────────────────────

export function PlanManager() {
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const session = await getSession();
        if (!session) throw new Error("Not authenticated");

        const supabase = getSupabaseClient();
        const { data, error: dbErr } = await supabase
          .from("subscriptions")
          .select("plan, status, current_period_end, stripe_customer_id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (dbErr) throw new Error(dbErr.message);

        if (!cancelled) {
          setSub(data
            ? {
                plan: data.plan as CloudPlan | null,
                status: data.status,
                periodEnd: data.current_period_end,
                stripeCustomerId: data.stripe_customer_id,
              }
            : { plan: null, status: null, periodEnd: null, stripeCustomerId: null });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load subscription");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const handleSelectPlan = async (plan: CloudPlan) => {
    setActionLoading(true);
    setError(null);
    try {
      const { url } = await workerRpc<{ url: string }>("billing.createCheckout", { plan });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setActionLoading(false);
    }
  };

  const handleManagePortal = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const { url } = await workerRpc<{ url: string }>("billing.createPortalSession", {});
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading plan…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="size-4 text-primary" />
        <span className="font-medium">Plan</span>
      </div>

      {/* Current plan */}
      <div className="rounded-md border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">
              {sub?.plan ?? "No plan"}
            </span>
            {sub?.status && (
              <Badge variant={STATUS_VARIANT[sub.status] ?? "secondary"} className="text-xs">
                {STATUS_LABEL[sub.status] ?? sub.status}
              </Badge>
            )}
          </div>

          {sub?.plan && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleManagePortal}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ExternalLink className="size-3" />
              )}
              Manage
            </Button>
          )}
        </div>

        {sub?.periodEnd && (
          <p className="text-xs text-muted-foreground">
            Renews {new Date(sub.periodEnd).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}

        {sub?.status === "past_due" && (
          <div className="flex items-start gap-1.5 text-xs text-yellow-600">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <span>Payment is overdue. Please update your payment method.</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Upgrade / plan selection */}
      {!sub?.plan ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Choose a plan to get started.</p>
          <PlanSelector onSelect={handleSelectPlan} loading={actionLoading} />
        </div>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowSelector((v) => !v)}
          >
            {showSelector ? "Hide plans" : "Change plan"}
          </Button>

          {showSelector && (
            <>
              <Separator />
              <PlanSelector
                currentPlan={sub.plan}
                onSelect={handleSelectPlan}
                loading={actionLoading}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
