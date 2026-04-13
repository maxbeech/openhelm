import { describe, it, expect, beforeEach } from "vitest";
import { useDemoStore } from "./demo-store";

describe("DemoStore", () => {
  beforeEach(() => {
    useDemoStore.setState({
      isDemo: false,
      slug: null,
      demoProjectId: null,
      signupModalOpen: false,
      signupModalContext: null,
    });
  });

  it("enter() flips isDemo and records slug + projectId", () => {
    useDemoStore.getState().enter({ slug: "nike", projectId: "demo-nike-project" });
    const s = useDemoStore.getState();
    expect(s.isDemo).toBe(true);
    expect(s.slug).toBe("nike");
    expect(s.demoProjectId).toBe("demo-nike-project");
  });

  it("leave() clears all demo state including modal", () => {
    useDemoStore.setState({
      isDemo: true,
      slug: "nike",
      demoProjectId: "demo-nike-project",
      signupModalOpen: true,
      signupModalContext: { trigger: "cta_click" },
    });
    useDemoStore.getState().leave();
    const s = useDemoStore.getState();
    expect(s.isDemo).toBe(false);
    expect(s.slug).toBeNull();
    expect(s.demoProjectId).toBeNull();
    expect(s.signupModalOpen).toBe(false);
    expect(s.signupModalContext).toBeNull();
  });

  it("showSignupModal() opens with the given context", () => {
    useDemoStore.getState().showSignupModal({
      trigger: "write_blocked",
      method: "jobs.create",
    });
    const s = useDemoStore.getState();
    expect(s.signupModalOpen).toBe(true);
    expect(s.signupModalContext?.trigger).toBe("write_blocked");
    expect(s.signupModalContext?.method).toBe("jobs.create");
  });

  it("hideSignupModal() closes and clears context", () => {
    useDemoStore.getState().showSignupModal({ trigger: "rate_limit", reason: "ip_cap_reached" });
    useDemoStore.getState().hideSignupModal();
    const s = useDemoStore.getState();
    expect(s.signupModalOpen).toBe(false);
    expect(s.signupModalContext).toBeNull();
  });
});
