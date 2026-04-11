/**
 * Worker Service — environment variable configuration.
 * All required variables are validated at startup; missing ones throw immediately.
 */

function require(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[worker] Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  /** Supabase project URL */
  supabaseUrl: require("SUPABASE_URL"),

  /** Supabase service role key — bypasses RLS; never exposed to clients */
  supabaseServiceKey: require("SUPABASE_SERVICE_KEY"),

  /** OpenRouter API key — used for both Goose sandbox runs and direct LLM calls */
  openrouterApiKey: require("OPENROUTER_API_KEY"),

  /** E2B API key for sandbox creation */
  e2bApiKey: require("E2B_API_KEY"),

  /** E2B sandbox template ID containing Goose + OpenHelm MCPs */
  e2bTemplateId: optional("E2B_TEMPLATE_ID", "openhelm-goose"),

  /** Maximum concurrent sandbox runs per user */
  maxConcurrentRunsPerUser: parseInt(optional("MAX_CONCURRENT_RUNS_PER_USER", "2"), 10),

  /** Scheduler tick interval in milliseconds */
  tickIntervalMs: parseInt(optional("TICK_INTERVAL_MS", "60000"), 10),

  /** HTTP server port for health endpoint */
  port: parseInt(optional("PORT", "8080"), 10),

  /** Default sandbox timeout in milliseconds (30 minutes) */
  sandboxTimeoutMs: parseInt(optional("SANDBOX_TIMEOUT_MS", "1800000"), 10),

  /** Worker HTTP base URL (for frontend RPC calls in cloud mode) */
  workerUrl: optional("WORKER_URL", "http://localhost:8080"),

  /** Stripe secret key (sk_live_* in production, sk_test_* in dev) */
  stripeSecretKey: optional("STRIPE_SECRET_KEY", ""),

  /**
   * Stripe Price IDs — GBP defaults for each Cloud plan.
   * Currency-specific variants follow the pattern STRIPE_PRICE_{TIER}_{CURRENCY}.
   * The billing handler selects the right price ID based on the user's currency.
   */
  stripePriceBasic: optional("STRIPE_PRICE_BASIC", ""),
  stripePricePro: optional("STRIPE_PRICE_PRO", ""),
  stripePriceMax: optional("STRIPE_PRICE_MAX", ""),

  /** Per-currency price IDs — Basic */
  stripePriceBasicGbp: optional("STRIPE_PRICE_BASIC_GBP", ""),
  stripePriceBasicUsd: optional("STRIPE_PRICE_BASIC_USD", ""),
  stripePriceBasicEur: optional("STRIPE_PRICE_BASIC_EUR", ""),
  stripePriceBasicCad: optional("STRIPE_PRICE_BASIC_CAD", ""),
  stripePriceBasicAud: optional("STRIPE_PRICE_BASIC_AUD", ""),

  /** Per-currency price IDs — Pro */
  stripePriceProGbp: optional("STRIPE_PRICE_PRO_GBP", ""),
  stripePriceProUsd: optional("STRIPE_PRICE_PRO_USD", ""),
  stripePriceProEur: optional("STRIPE_PRICE_PRO_EUR", ""),
  stripePriceProCad: optional("STRIPE_PRICE_PRO_CAD", ""),
  stripePriceProAud: optional("STRIPE_PRICE_PRO_AUD", ""),

  /** Per-currency price IDs — Max */
  stripePriceMaxGbp: optional("STRIPE_PRICE_MAX_GBP", ""),
  stripePriceMaxUsd: optional("STRIPE_PRICE_MAX_USD", ""),
  stripePriceMaxEur: optional("STRIPE_PRICE_MAX_EUR", ""),
  stripePriceMaxCad: optional("STRIPE_PRICE_MAX_CAD", ""),
  stripePriceMaxAud: optional("STRIPE_PRICE_MAX_AUD", ""),

  /** App base URL (used for Stripe redirect URLs) */
  appUrl: optional("APP_URL", "http://localhost:5173"),
} as const;
