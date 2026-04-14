/**
 * Supabase client singleton for the frontend (cloud mode).
 *
 * Uses the public anon key — all queries are subject to RLS policies.
 * Auth is managed via Supabase Auth (session stored in localStorage).
 */

import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

// Vercel-exported .env.local values sometimes carry a trailing newline
// (the Vercel dashboard stores "URL\n" for URL fields). Trim once at
// import time so every consumer sees a clean URL — a stray \n breaks
// fetch silently and makes voice/chat RPC failures hard to diagnose.
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined)?.trim();

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "[supabase-client] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for cloud mode",
      );
    }
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return _supabase;
}

/** Current authenticated session, or null. */
export async function getSession(): Promise<Session | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session;
}

/** Worker Service base URL for action RPCs. */
export function getWorkerUrl(): string {
  return WORKER_URL ?? "http://localhost:8080";
}
