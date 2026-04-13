/**
 * DemoBanner — sticky top strip for demo visitors.
 *
 * Shows the demo name, a sign-up CTA (or "back to your workspace" for real
 * logged-in users), and a subtle badge indicating read-only mode. Clicking
 * the CTA opens the signup modal via the demo store.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useDemoStore } from "../../stores/demo-store";
import { getSupabaseClient } from "../../lib/supabase-client";
import { useProjectStore } from "../../stores/project-store";
import { captureEvent } from "../../lib/posthog";

export function DemoBanner() {
  const slug = useDemoStore((s) => s.slug);
  const demoProjectId = useDemoStore((s) => s.demoProjectId);
  const showSignupModal = useDemoStore((s) => s.showSignupModal);
  const project = useProjectStore((s) =>
    demoProjectId ? s.projects.find((p) => p.id === demoProjectId) : null,
  );

  const [isAnonymous, setIsAnonymous] = useState<boolean>(true);

  // Check whether the current session is an anonymous one. Real logged-in
  // users get a different CTA ("back to your workspace").
  useEffect(() => {
    const supabase = getSupabaseClient();
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      // Supabase flags anon users via user.is_anonymous on v2+.
      const anon = (data.session?.user as { is_anonymous?: boolean } | undefined)
        ?.is_anonymous ?? true;
      setIsAnonymous(anon);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = project?.name ?? slug ?? "demo";

  const onSignUp = () => {
    captureEvent("demo_signup_cta_clicked", { slug: slug ?? "", trigger: "cta" });
    showSignupModal({ trigger: "cta_click" });
  };

  const onBackToWorkspace = () => {
    // Full navigation out of the demo route — the DemoRoute cleanup effect
    // will call useDemoStore.leave() when it unmounts.
    window.location.href = "/";
  };

  return (
    <div
      role="banner"
      className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 text-sm"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium">
          {`You're viewing the ${displayName} demo`}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Read-only
        </span>
      </div>
      {isAnonymous ? (
        <button
          type="button"
          onClick={onSignUp}
          className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign up to try OpenHelm free
        </button>
      ) : (
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="h-7 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          Back to your workspace
        </button>
      )}
    </div>
  );
}
