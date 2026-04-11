/**
 * AuthGuard — wraps the app to enforce authentication in cloud mode.
 *
 * - Local (Tauri) mode: passes children through immediately
 * - Cloud mode: checks Supabase session; shows login page if unauthenticated
 */

import { useState, useEffect, type ReactNode } from "react";
import { isLocalMode } from "../../lib/mode.js";
import { getSupabaseClient } from "../../lib/supabase-client.js";
import { LoginPage } from "./login-page.js";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  // In local mode there's no auth — render immediately
  if (isLocalMode) return <>{children}</>;

  return <CloudAuthGuard>{children}</CloudAuthGuard>;
}

function CloudAuthGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Check existing session on mount
    supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? "authenticated" : "unauthenticated");
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setState("authenticated");
      } else if (event === "SIGNED_OUT") {
        setState("unauthenticated");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (state === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (state === "unauthenticated") {
    return <LoginPage />;
  }

  return <>{children}</>;
}
