/**
 * DemoRoute — entry point for public /demo/:slug visits.
 *
 * Bootstrap sequence:
 *  1. Ensure a Supabase session exists. If none, sign in anonymously so
 *     PostgREST carries a JWT (needed even for SELECT-from-demo queries
 *     because RLS policies reference auth.uid() even when allowing reads).
 *  2. Look up the demo project by slug via the existing CRUD handler.
 *     Returns null if the slug doesn't map to an is_demo=true project.
 *  3. Flip the demo store into "isDemo" mode with the resolved project id.
 *  4. Seed app-store with activeProjectId=demoProjectId, onboardingComplete=true
 *     and agentReady=true so the reused <App> renders without triggering
 *     onboarding or a local-agent wait.
 *  5. Render <App /> inside a <DemoFrame> that layers a banner and the
 *     signup modal over the normal UI.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import App from "../App";
import { getSupabaseClient } from "../lib/supabase-client";
import { getProjectBySlug } from "../lib/api";
import { useDemoStore } from "../stores/demo-store";
import { useAppStore } from "../stores/app-store";
import { DemoFrame } from "../components/demo/demo-frame";
import { captureEvent } from "../lib/posthog";
import type { Project } from "@openhelm/shared";

type LoadState = "loading" | "ready" | "not_found" | "error";

export function DemoRoute() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setState("not_found");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseClient();

        // 1. Ensure a session — anon sign-in is fine for demos. Real users
        //    keep their existing session; they'll still be put into the
        //    isolated DemoFrame so their real workspace stays hidden.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const { error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw new Error(`anon sign-in failed: ${signInError.message}`);
        }

        // 2. Look up the demo project by slug. Transport guard explicitly
        //    allows projects.getBySlug even before demo mode is flipped on.
        const project = (await getProjectBySlug(slug)) as Project | null;
        if (cancelled) return;
        if (!project) {
          setState("not_found");
          return;
        }

        // 3 + 4. Flip demo store + seed app store so <App> renders cleanly.
        useDemoStore.getState().enter({ slug, projectId: project.id });
        useAppStore.setState({
          activeProjectId: project.id,
          onboardingComplete: true,
          agentReady: true,
          contentView: "dashboard",
        });

        captureEvent("demo_viewed", { slug });

        if (!cancelled) setState("ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[demo-route] bootstrap failed:", message);
        if (!cancelled) {
          setErrorMessage(message);
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Reset demo store on unmount so navigating away cleanly leaves demo mode.
  useEffect(() => {
    return () => {
      useDemoStore.getState().leave();
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading demo…</div>
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-center">
        <h1 className="text-2xl font-semibold">Demo not found</h1>
        <p className="text-muted-foreground max-w-md">
          We couldn't find a demo called <code className="font-mono">{slug}</code>.
          Check the URL or head to{" "}
          <a href="/" className="underline">openhelm.ai</a>.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-center">
        <h1 className="text-2xl font-semibold">Demo couldn't load</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          {errorMessage ?? "An unexpected error occurred."}
        </p>
      </div>
    );
  }

  return (
    <DemoFrame>
      <App />
    </DemoFrame>
  );
}
