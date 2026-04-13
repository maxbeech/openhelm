/**
 * Unit tests for stripe-billing.ts
 *
 * Stubs global fetch to avoid real Stripe API calls.
 * Uses jest.unstable_mockModule for ESM-compatible Supabase mocking.
 *
 * Note: uses @jest/globals and dynamic imports for ESM compatibility.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Fetch stub ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch as unknown as typeof fetch;

function mockStripeOk(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockStripeErr(body: unknown, status = 400) {
  mockFetch.mockResolvedValueOnce({
    ok: false, status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ── Supabase stub (ESM-safe) ─────────────────────────────────────────────────

let mockSubData: unknown = null;
let mockSubError: unknown = null;

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: mockSubData, error: mockSubError }),
          }),
        }),
      }),
    }),
  }),
}));

// Dynamic imports AFTER mocks are registered
const { createCheckoutSession, createPortalSession, reportUsageOverage } =
  await import("../stripe-billing.js");

beforeEach(() => {
  mockFetch.mockReset();
  mockSubData = null;
  mockSubError = null;
});

// ── createCheckoutSession ─────────────────────────────────────────────────────

describe("createCheckoutSession", () => {
  it("creates a basic session and returns url + sessionId", async () => {
    mockStripeOk({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" });

    const result = await createCheckoutSession({
      userId: "user-abc",
      plan: "basic",
      userEmail: "test@example.com",
      successUrl: "https://app.openhelm.ai?billing=success",
      cancelUrl: "https://app.openhelm.ai?billing=cancelled",
    });

    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test_123");
    expect(result.sessionId).toBe("cs_test_123");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(options.method).toBe("POST");
    expect(options.body as string).toContain("user-abc");
    expect(options.body as string).toContain("test%40example.com");
  });

  it("omits customer_email when not provided", async () => {
    mockStripeOk({ id: "cs_pro_456", url: "https://checkout.stripe.com/pay/cs_pro_456" });

    await createCheckoutSession({
      userId: "user-xyz",
      plan: "pro",
      successUrl: "https://app.openhelm.ai",
      cancelUrl: "https://app.openhelm.ai",
    });

    const body = (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(body).not.toContain("customer_email");
  });

  it("uses max price ID for max plan", async () => {
    mockStripeOk({ id: "cs_max", url: "https://checkout.stripe.com/pay/cs_max" });

    await createCheckoutSession({
      userId: "u",
      plan: "max",
      successUrl: "https://app.openhelm.ai",
      cancelUrl: "https://app.openhelm.ai",
    });

    // Stripe should have been called (price ID comes from env mock in setup.ts)
    expect(mockFetch).toHaveBeenCalled();
  });

  it("throws for unknown plan without calling Stripe", async () => {
    await expect(
      createCheckoutSession({
        userId: "user-abc",
        plan: "enterprise",
        successUrl: "https://app.openhelm.ai",
        cancelUrl: "https://app.openhelm.ai",
      }),
    ).rejects.toThrow("Unknown plan: enterprise");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on Stripe API error response", async () => {
    mockStripeErr({ error: { message: "Invalid API key" } }, 401);

    await expect(
      createCheckoutSession({
        userId: "user-abc",
        plan: "basic",
        successUrl: "https://app.openhelm.ai",
        cancelUrl: "https://app.openhelm.ai",
      }),
    ).rejects.toThrow("Invalid API key");
  });
});

// ── createPortalSession ────────────────────────────────────────────────────────

describe("createPortalSession", () => {
  it("creates a portal session and returns url", async () => {
    mockStripeOk({ id: "bps_test_789", url: "https://billing.stripe.com/session/bps_test_789" });

    const result = await createPortalSession("cus_test_abc", "https://app.openhelm.ai/settings");

    expect(result.url).toBe("https://billing.stripe.com/session/bps_test_789");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(options.body as string).toContain("cus_test_abc");
  });

  it("throws on Stripe API error", async () => {
    mockStripeErr({ error: { message: "No such customer" } }, 404);

    await expect(
      createPortalSession("cus_bad", "https://app.openhelm.ai"),
    ).rejects.toThrow("No such customer");
  });
});

// ── reportUsageOverage ─────────────────────────────────────────────────────────

describe("reportUsageOverage", () => {
  it("reports overage when used credits exceed included credits", async () => {
    mockSubData = {
      stripe_subscription_id: "sub_test",
      stripe_overage_price_item_id: "si_test_overage",
      used_token_credits: 300_000_000,
      included_token_credits: 200_000_000,
      current_period_start: "2026-04-01T00:00:00Z",
    };
    mockStripeOk({ id: "mbur_test" });

    await reportUsageOverage("user-abc");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/subscription_items/si_test_overage/usage_records");
    // 300M - 200M = 100M overage credits
    expect(options.body as string).toContain("quantity=100000000");
  });

  it("skips reporting when within included limit", async () => {
    mockSubData = {
      stripe_subscription_id: "sub_test",
      stripe_overage_price_item_id: "si_test_overage",
      used_token_credits: 50_000_000,
      included_token_credits: 200_000_000,
      current_period_start: "2026-04-01T00:00:00Z",
    };

    await reportUsageOverage("user-abc");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when no active subscription found", async () => {
    mockSubData = null;
    mockSubError = { message: "not found" };

    await reportUsageOverage("user-abc");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when no overage price item configured", async () => {
    mockSubData = {
      stripe_subscription_id: "sub_test",
      stripe_overage_price_item_id: null,
      used_token_credits: 500_000_000,
      included_token_credits: 200_000_000,
      current_period_start: "2026-04-01T00:00:00Z",
    };

    await reportUsageOverage("user-abc");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
