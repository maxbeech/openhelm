import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * stripe-webhook — Handles Stripe subscription lifecycle events.
 *
 * Required env vars (set in Supabase dashboard → Settings → Edge Functions):
 *   STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard → Webhooks → signing secret
 *   STRIPE_PRICE_MAP       — optional JSON override: { "price_xxx": "basic", ... }
 *   SUPABASE_URL           — auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
 */

const PLAN_TOKEN_CREDITS: Record<string, number> = {
  basic: 50_000_000,
  pro:   200_000_000,
  max:   1_000_000_000,
};

/** Hardcoded map of all known Stripe price IDs → plan names. */
const HARDCODED_PRICE_MAP: Record<string, string> = {
  // Basic — £39 / $49 / €46 / CA$68 / A$79
  price_1TKgvqAkXA6UL8dTjZeECRhl: "basic",
  price_1TKgvqAkXA6UL8dTFzmrXeVa: "basic",
  price_1TKgvrAkXA6UL8dT9gwgDaMb: "basic",
  price_1TKgvrAkXA6UL8dTiLi0mUyV: "basic",
  price_1TKgvrAkXA6UL8dThVuzzx1N: "basic",
  // Pro — £89 / $115 / €105 / CA$155 / A$179
  price_1TKgvsAkXA6UL8dT2FKY5v1U: "pro",
  price_1TKgvsAkXA6UL8dT8eMI4q1O: "pro",
  price_1TKgvtAkXA6UL8dTgZT9P4Ym: "pro",
  price_1TKgvtAkXA6UL8dTFx8QP1Vx: "pro",
  price_1TKgvtAkXA6UL8dTSXVviOQb: "pro",
  // Max — £189 / $249 / €229 / CA$329 / A$389
  price_1TKgvuAkXA6UL8dTQyEkARmj: "max",
  price_1TKgvuAkXA6UL8dTdy29bNYF: "max",
  price_1TKgvvAkXA6UL8dTCIMw6sXd: "max",
  price_1TKgvvAkXA6UL8dTh65wPoio: "max",
  price_1TKgvwAkXA6UL8dTvZdE8kbL: "max",
};

/** Merge hardcoded map with optional STRIPE_PRICE_MAP env override. */
function getPriceMap(): Record<string, string> {
  const raw = Deno.env.get("STRIPE_PRICE_MAP");
  if (!raw) return HARDCODED_PRICE_MAP;
  try { return { ...HARDCODED_PRICE_MAP, ...JSON.parse(raw) }; } catch { return HARDCODED_PRICE_MAP; }
}

async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const parts = signature.split(",");
  const tPart  = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp    = tPart.slice(2);
  const receivedSig  = v1Part.slice(3);
  const payload      = `${timestamp}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expectedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedSig.length !== receivedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ receivedSig.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

  const body  = await req.text();
  const valid = await verifyStripeSignature(body, signature, webhookSecret);
  if (!valid) return new Response("Invalid signature", { status: 400 });

  let event: { type: string; data: { object: Record<string, unknown> } };
  try { event = JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const priceMap = getPriceMap();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // Link Stripe customer to Supabase user and create subscription record.
        // user_id is embedded in session metadata at checkout creation time.
        const session = event.data.object;
        const userId = (session.metadata as Record<string, string>)?.user_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string | undefined;
        const plan = (session.metadata as Record<string, string>)?.plan ?? "basic";

        if (!userId) {
          console.error("[stripe-webhook] checkout.session.completed missing metadata.user_id");
          break;
        }

        // Upsert subscription row (may already exist from subscription.created)
        const { error: upsertErr } = await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId ?? null,
            plan,
            status: "active",
            included_token_credits: PLAN_TOKEN_CREDITS[plan] ?? PLAN_TOKEN_CREDITS.basic,
            used_token_credits: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id", ignoreDuplicates: false },
        );
        if (upsertErr) {
          console.error("[stripe-webhook] failed to upsert subscription:", upsertErr.message);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub        = event.data.object;
        const customerId = sub.customer as string;
        const priceId    = (sub.items as { data: Array<{ price: { id: string } }> }).data[0]?.price?.id;
        const plan       = priceMap[priceId] ?? "basic";

        await supabase.from("subscriptions").update({
          stripe_subscription_id:  sub.id,
          plan,
          status:                  sub.status,
          current_period_start:    new Date((sub.current_period_start as number) * 1000).toISOString(),
          current_period_end:      new Date((sub.current_period_end as number) * 1000).toISOString(),
          included_token_credits:  PLAN_TOKEN_CREDITS[plan] ?? PLAN_TOKEN_CREDITS.basic,
          updated_at:              new Date().toISOString(),
        }).eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted":
        await supabase.from("subscriptions").update({
          status: "cancelled", updated_at: new Date().toISOString(),
        }).eq("stripe_customer_id", event.data.object.customer as string);
        break;

      case "invoice.payment_succeeded":
        // Reset token usage at the start of a new billing period
        await supabase.from("subscriptions").update({
          used_token_credits: 0, updated_at: new Date().toISOString(),
        }).eq("stripe_customer_id", event.data.object.customer as string);
        break;

      case "invoice.payment_failed":
        await supabase.from("subscriptions").update({
          status: "past_due", updated_at: new Date().toISOString(),
        }).eq("stripe_customer_id", event.data.object.customer as string);
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
