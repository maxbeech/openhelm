/**
 * Supabase service-role client for the Worker Service.
 * Uses the service key to bypass RLS — this client MUST NOT be exposed to users.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
