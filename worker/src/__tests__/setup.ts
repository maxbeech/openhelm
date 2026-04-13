/**
 * Jest setup file — sets required and optional env vars before any module is loaded.
 * This prevents config.ts from throwing on "Missing required env var".
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-openrouter-key";
process.env.E2B_API_KEY = process.env.E2B_API_KEY || "test-e2b-key";

// Stripe config (optional fields, set here so tests can assert on them)
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_fake";
process.env.STRIPE_PRICE_BASIC = process.env.STRIPE_PRICE_BASIC || "price_basic_test";
process.env.STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || "price_pro_test";
process.env.STRIPE_PRICE_MAX = process.env.STRIPE_PRICE_MAX || "price_max_test";
process.env.APP_URL = process.env.APP_URL || "https://app.openhelm.ai";
