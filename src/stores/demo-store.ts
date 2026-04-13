/**
 * Demo mode state — scoped to the public /demo/:slug experience.
 *
 * This store is intentionally minimal. It records:
 *  - whether we're currently inside a demo (set by <DemoRoute> on mount)
 *  - the demo slug and resolved demo project id
 *  - the signup modal visibility and the reason it was opened
 *
 * Everything else (views, selection state, chat, data tables) reuses the
 * existing Zustand stores, scoped to the demo project via activeProjectId.
 */

import { create } from "zustand";

export type SignupModalTrigger =
  | "cta_click"
  | "write_blocked"
  | "rate_limit";

export interface SignupModalContext {
  trigger: SignupModalTrigger;
  /** For "write_blocked", the method name that was attempted. */
  method?: string;
  /** For "rate_limit", the reason code from the worker. */
  reason?: string;
}

interface DemoState {
  isDemo: boolean;
  slug: string | null;
  demoProjectId: string | null;
  signupModalOpen: boolean;
  signupModalContext: SignupModalContext | null;

  enter: (params: { slug: string; projectId: string }) => void;
  leave: () => void;
  showSignupModal: (context: SignupModalContext) => void;
  hideSignupModal: () => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  isDemo: false,
  slug: null,
  demoProjectId: null,
  signupModalOpen: false,
  signupModalContext: null,

  enter: ({ slug, projectId }) =>
    set({ isDemo: true, slug, demoProjectId: projectId }),

  leave: () =>
    set({
      isDemo: false,
      slug: null,
      demoProjectId: null,
      signupModalOpen: false,
      signupModalContext: null,
    }),

  showSignupModal: (context) =>
    set({ signupModalOpen: true, signupModalContext: context }),

  hideSignupModal: () =>
    set({ signupModalOpen: false, signupModalContext: null }),
}));
