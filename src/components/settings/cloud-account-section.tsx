/**
 * CloudAccountSection — shows the signed-in user's email and a sign-out button.
 * Only rendered in cloud mode.
 */

import { useEffect, useState } from "react";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabase-client";

export function CloudAccountSection() {
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    getSupabaseClient()
      .auth.getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null))
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await getSupabaseClient().auth.signOut();
    } finally {
      // Reload to clear all in-memory state and return to the auth screen
      window.location.reload();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <User className="size-4 text-primary" />
        <span className="font-medium">Account</span>
      </div>
      <div className="rounded-md border border-border bg-card p-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground truncate">
          {email ?? "—"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs shrink-0"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut className="size-3" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
