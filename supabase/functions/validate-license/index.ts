import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * validate-license — Business tier license key validation.
 *
 * Called by the local desktop app on startup to confirm the license key
 * is valid and retrieve the maximum seat count.
 *
 * Request:  POST with JSON body: { "key": "<license-key>" }
 * Response: { valid: boolean, plan: string, maxSeats: number, email: string, expiresAt: string | null }
 *
 * No auth required — the license key is the secret. The function is
 * callable from the desktop app without a Supabase session.
 */

Deno.serve(async (req: Request) => {
  // CORS for desktop app's WebView
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.key || typeof body.key !== "string") {
    return new Response(
      JSON.stringify({ valid: false, error: "License key is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc("validate_license_key", {
    p_key: body.key.trim(),
  });

  if (error) {
    console.error("[validate-license] RPC error:", error.message);
    return new Response(
      JSON.stringify({ valid: false, error: "Validation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const row = data?.[0];
  if (!row) {
    return new Response(
      JSON.stringify({ valid: false, error: "License key not found" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      valid: row.valid,
      plan: row.plan,
      status: row.status,
      maxSeats: row.max_seats,
      email: row.email,
      expiresAt: row.expires_at ?? null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
