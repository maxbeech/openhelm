/**
 * Stripe Billing — direct REST API calls for subscription management.
 *
 * Handles:
 *  - Checkout session creation (new subscriptions)
 *  - Customer Portal session (manage billing)
 *  - Metered usage overage reporting (end-of-period)
 *
 * Uses fetch against Stripe's REST API (no Node SDK dependency).
 * API reference: https://stripe.com/docs/api
 */

import { config } from "./config.js";
import { getSupabase } from "./supabase.js";

/**
 * Resolve the Stripe Price ID for a plan + currency combination.
 * Falls back to the GBP default if no currency-specific price is configured.
 */
function getPriceId(plan: string, currency = "gbp"): string {
  const cur = currency.toLowerCase();
  const key = `stripePrice${plan.charAt(0).toUpperCase() + plan.slice(1)}${cur.charAt(0).toUpperCase() + cur.slice(1)}` as keyof typeof config;
  const currencySpecific = config[key] as string | undefined;
  if (currencySpecific) return currencySpecific;

  // Fall back to GBP default
  const defaultKey = `stripePrice${plan.charAt(0).toUpperCase() + plan.slice(1)}` as keyof typeof config;
  const defaultId = config[defaultKey] as string | undefined;
  if (!defaultId) throw new Error(`Unknown plan: ${plan}`);
  return defaultId;
}

/** Encode object as application/x-www-form-urlencoded for Stripe API. */
function encodeForm(data: Record<string, string | number | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function stripePost(path: string, data: Record<string, string | number | undefined>): Promise<unknown> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(data),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { message?: string } | undefined;
    throw new Error(`Stripe ${path} failed (${res.status}): ${err?.message ?? "unknown error"}`);
  }
  return body;
}

// ── Checkout session ──────────────────────────────────────────────────────────

export interface CreateCheckoutParams {
  userId: string;
  /** Plan name: "basic" | "pro" | "max" */
  plan: string;
  /** ISO 4217 currency code (lowercase). Defaults to "gbp". */
  currency?: string;
  userEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  sessionId: string;
}

/**
 * Create a Stripe Checkout Session for a new Cloud subscription.
 * The user_id is embedded in session metadata so the webhook can link
 * the Stripe customer to the Supabase user on checkout.session.completed.
 */
export async function createCheckoutSession(
  params: CreateCheckoutParams,
): Promise<CheckoutResult> {
  const priceId = getPriceId(params.plan, params.currency);

  const data: Record<string, string | number> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    "subscription_data[trial_period_days]": 7,
    "subscription_data[metadata][user_id]": params.userId,
    "subscription_data[metadata][plan]": params.plan,
    "metadata[user_id]": params.userId,
    "metadata[plan]": params.plan,
  };
  if (params.userEmail) {
    data.customer_email = params.userEmail;
  }

  const session = (await stripePost("/checkout/sessions", data)) as {
    id: string;
    url: string;
  };
  return { url: session.url, sessionId: session.id };
}

// ── Customer Portal ────────────────────────────────────────────────────────────

export interface PortalResult {
  url: string;
}

/**
 * Create a Stripe Customer Portal session for an existing customer.
 * Allows them to update payment method, download invoices, cancel.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<PortalResult> {
  const session = (await stripePost("/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  })) as { url: string };
  return { url: session.url };
}

// ── Usage overage reporting ───────────────────────────────────────────────────

/**
 * Report metered token overage to Stripe for the previous billing period.
 *
 * Called on invoice.upcoming webhook or a periodic cron job.
 * Calculates overage = used_token_credits - included_token_credits.
 * Reports to the subscription's metered price item.
 *
 * Uses idempotency via the billing period start as the idempotency key.
 */
export async function reportUsageOverage(userId: string): Promise<void> {
  const supabase = getSupabase();

  interface SubRow {
    stripe_subscription_id: string;
    stripe_overage_price_item_id: string | null;
    used_token_credits: number;
    included_token_credits: number;
    current_period_start: string;
  }

  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select(
      "stripe_subscription_id, stripe_overage_price_item_id, " +
      "used_token_credits, included_token_credits, current_period_start",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .single() as { data: SubRow | null; error: unknown };

  if (error || !sub) {
    console.error(`[stripe-billing] no active subscription for user ${userId}`);
    return;
  }

  const overage = Math.max(
    0,
    (sub.used_token_credits as number) - (sub.included_token_credits as number),
  );
  if (overage === 0) return;

  if (!sub.stripe_overage_price_item_id) {
    console.error(`[stripe-billing] no overage price item for user ${userId}`);
    return;
  }

  // Idempotency key = subscription ID + period start
  const idempotencyKey = `overage-${sub.stripe_subscription_id}-${sub.current_period_start}`;

  try {
    await stripePost(
      `/subscription_items/${sub.stripe_overage_price_item_id}/usage_records`,
      {
        quantity: overage,
        action: "set",
        timestamp: "now",
      },
    );
    console.error(`[stripe-billing] reported ${overage} overage credits for user ${userId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't throw — log but allow normal flow to continue
    if (!msg.includes(idempotencyKey)) {
      console.error(`[stripe-billing] usage report failed for user ${userId}:`, msg);
    }
  }
}

// ── Subscription lookup ────────────────────────────────────────────────────────

/** Retrieve a Stripe subscription record (for webhook verification helpers). */
export async function getStripeSubscription(subscriptionId: string): Promise<{
  status: string;
  customerId: string;
  currentPeriodEnd: number;
}> {
  const sub = (await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  }).then((r) => r.json())) as {
    status: string;
    customer: string;
    current_period_end: number;
  };
  return {
    status: sub.status,
    customerId: sub.customer,
    currentPeriodEnd: sub.current_period_end,
  };
}
