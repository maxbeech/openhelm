import type {
  EmployeeCount,
  CheckoutSessionResult,
  PollCheckoutSessionResult,
  CustomerPortalResult,
} from "@openhelm/shared";

const WEBSITE_URL =
  process.env.OPENHELM_WEBSITE_URL ?? "https://openhelm.dev";

/** Create a Stripe Checkout Session via the website proxy */
export async function createCheckoutSession(
  email: string,
  employeeCount: EmployeeCount,
): Promise<CheckoutSessionResult> {
  const res = await fetch(`${WEBSITE_URL}/api/stripe/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, employeeCount }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Checkout session creation failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<CheckoutSessionResult>;
}

/** Poll the Stripe session status via the website proxy */
export async function pollCheckoutSession(
  sessionId: string,
): Promise<PollCheckoutSessionResult> {
  const res = await fetch(`${WEBSITE_URL}/api/stripe/check-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!res.ok) {
    throw new Error(`Session poll failed (${res.status})`);
  }

  return res.json() as Promise<PollCheckoutSessionResult>;
}

/** Create a Stripe Customer Portal session via the website proxy */
export async function createPortalSession(
  customerId: string,
): Promise<CustomerPortalResult> {
  const res = await fetch(`${WEBSITE_URL}/api/stripe/create-portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Portal session creation failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<CustomerPortalResult>;
}

/** Verify a Stripe subscription status via the website proxy */
export async function verifySubscription(
  subscriptionId: string,
): Promise<{ status: string; trialEnd: string | null; currentPeriodEnd: string | null }> {
  const res = await fetch(`${WEBSITE_URL}/api/stripe/verify-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscriptionId }),
  });

  if (!res.ok) {
    throw new Error(`Subscription verification failed (${res.status})`);
  }

  return res.json();
}
