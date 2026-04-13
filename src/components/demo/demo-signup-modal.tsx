/**
 * DemoSignupModal — opens whenever a demo visitor attempts a write or hits
 * a rate limit. Copy changes based on the trigger so the CTA is contextual.
 *
 * Actual sign-up is delegated to the regular cloud auth flow — we just
 * route the user to /login?from=demo&slug=... where the existing LoginPage
 * handles email / OAuth. Future work can embed a more optimized inline
 * form if conversion data suggests the redirect is hurting the funnel.
 */

import { useDemoStore } from "../../stores/demo-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { captureEvent } from "../../lib/posthog";

export function DemoSignupModal() {
  const open = useDemoStore((s) => s.signupModalOpen);
  const context = useDemoStore((s) => s.signupModalContext);
  const slug = useDemoStore((s) => s.slug);
  const hideSignupModal = useDemoStore((s) => s.hideSignupModal);

  const { title, description } = buildCopy(context?.trigger ?? "cta_click");

  const onSignUp = () => {
    captureEvent("demo_signup_cta_clicked", {
      slug: slug ?? "",
      trigger: context?.trigger ?? "cta_click",
    });
    const params = new URLSearchParams({ from: "demo" });
    if (slug) params.set("slug", slug);
    window.location.href = `/login?${params.toString()}`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? hideSignupModal() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li>• Run agent jobs on your own projects</li>
          <li>• Build data tables and dashboards that stay up to date</li>
          <li>• Set goals once and let OpenHelm self-correct on every run</li>
          <li>• Free tier — no credit card required</li>
        </ul>

        <DialogFooter className="mt-4 flex gap-2 sm:justify-between">
          <button
            type="button"
            onClick={hideSignupModal}
            className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            Keep exploring
          </button>
          <button
            type="button"
            onClick={onSignUp}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign up free
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCopy(trigger: "cta_click" | "write_blocked" | "rate_limit") {
  switch (trigger) {
    case "write_blocked":
      return {
        title: "That's a real action — sign up to try it",
        description:
          "This demo is read-only. Create a free OpenHelm account to run jobs, edit data, and build your own workspace.",
      };
    case "rate_limit":
      return {
        title: "You've used all your demo chat messages",
        description:
          "Free accounts get more chat, plus full access to run jobs and build data tables. No credit card required.",
      };
    case "cta_click":
    default:
      return {
        title: "Start using OpenHelm free",
        description:
          "You're exploring a canned demo. Sign up to connect your own project and let OpenHelm work on real goals.",
      };
  }
}
