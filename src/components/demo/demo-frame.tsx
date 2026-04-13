/**
 * DemoFrame — wraps the reused <App /> with a persistent banner and the
 * signup modal overlay. Only mounted under a /demo/:slug route.
 *
 * Layout:
 *   ┌────────────────────────────────────┐
 *   │  DemoBanner (sticky, 40px)         │
 *   ├────────────────────────────────────┤
 *   │                                    │
 *   │   children (= <App />)             │
 *   │                                    │
 *   └────────────────────────────────────┘
 *   + <DemoSignupModal /> (portal)
 */

import { type ReactNode } from "react";
import { DemoBanner } from "./demo-banner";
import { DemoSignupModal } from "./demo-signup-modal";

export function DemoFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <DemoBanner />
      <div className="min-h-0 flex-1">{children}</div>
      <DemoSignupModal />
    </div>
  );
}
