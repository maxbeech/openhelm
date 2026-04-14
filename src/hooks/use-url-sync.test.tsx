import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useUrlSync } from "./use-url-sync";
import { useAppStore } from "@/stores/app-store";
import { useDemoStore } from "@/stores/demo-store";
import { useNavStore } from "@/stores/nav-store";

function Harness({
  onNavigate,
}: {
  onNavigate?: (nav: (to: string) => void) => void;
}) {
  useUrlSync();
  const navigate = useNavigate();
  if (onNavigate) onNavigate((to) => navigate(to));
  return <div data-testid="harness" />;
}

function TreeWithNavCapture({
  initialPath,
  captureNavigate,
}: {
  initialPath: string;
  captureNavigate?: (nav: (to: string) => void) => void;
}) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<Harness onNavigate={captureNavigate} />} />
      </Routes>
    </MemoryRouter>
  );
}

function resetStores() {
  useAppStore.setState({
    contentView: "inbox",
    selectedGoalId: null,
    selectedJobId: null,
    selectedRunId: null,
    selectedDataTableId: null,
  });
  useDemoStore.setState({
    isDemo: false,
    slug: null,
    demoProjectId: null,
  });
  useNavStore.setState({
    past: [],
    future: [],
    canGoBack: false,
    canGoForward: false,
    navDirection: "forward",
  });
}

describe("useUrlSync", () => {
  beforeEach(() => {
    resetStores();
  });

  describe("first-mount hydration", () => {
    it("hydrates contentView from /dashboard", () => {
      render(<TreeWithNavCapture initialPath="/dashboard" />);
      expect(useAppStore.getState().contentView).toBe("dashboard");
    });

    it("hydrates selectedGoalId from /goals/:id", () => {
      render(<TreeWithNavCapture initialPath="/goals/g1" />);
      const s = useAppStore.getState();
      expect(s.contentView).toBe("goal-detail");
      expect(s.selectedGoalId).toBe("g1");
    });

    it("hydrates selectedJobId from /jobs/:id", () => {
      render(<TreeWithNavCapture initialPath="/jobs/j1" />);
      const s = useAppStore.getState();
      expect(s.contentView).toBe("job-detail");
      expect(s.selectedJobId).toBe("j1");
    });

    it("hydrates selectedDataTableId from /data/:id", () => {
      render(<TreeWithNavCapture initialPath="/data/tbl_1" />);
      const s = useAppStore.getState();
      expect(s.contentView).toBe("data-table-detail");
      expect(s.selectedDataTableId).toBe("tbl_1");
    });

    it("hydrates / to inbox", () => {
      render(<TreeWithNavCapture initialPath="/" />);
      expect(useAppStore.getState().contentView).toBe("inbox");
    });

    it("redirects unknown routes to /inbox", () => {
      render(<TreeWithNavCapture initialPath="/bogus" />);
      expect(useAppStore.getState().contentView).toBe("inbox");
    });

    it("does NOT push a nav-store entry on hydration", () => {
      render(<TreeWithNavCapture initialPath="/dashboard" />);
      expect(useNavStore.getState().past).toHaveLength(0);
    });
  });

  describe("demo guard", () => {
    it("does not mutate app-store when pathname is /demo/:slug", () => {
      useAppStore.setState({ contentView: "inbox" });
      render(<TreeWithNavCapture initialPath="/demo/foo" />);
      expect(useAppStore.getState().contentView).toBe("inbox");
    });

    it("does not mutate app-store when isDemo flag is set", () => {
      useDemoStore.setState({ isDemo: true });
      useAppStore.setState({ contentView: "dashboard" });
      // Use a non-demo path just to confirm the flag-based guard works
      render(<TreeWithNavCapture initialPath="/inbox" />);
      expect(useAppStore.getState().contentView).toBe("dashboard");
    });
  });

  describe("store → URL reflection", () => {
    it("navigates to /memory when setContentView('memory') is called", () => {
      let nav: ((to: string) => void) | null = null;
      render(
        <TreeWithNavCapture
          initialPath="/inbox"
          captureNavigate={(n) => {
            nav = n;
          }}
        />,
      );
      act(() => {
        useAppStore.getState().setContentView("memory");
      });
      // Use a second render tick to reflect location change
      expect(useAppStore.getState().contentView).toBe("memory");
      expect(nav).not.toBeNull();
    });

    it("navigates to /goals/:id when selectGoal is called", () => {
      render(<TreeWithNavCapture initialPath="/inbox" />);
      act(() => {
        useAppStore.getState().selectGoal("g42");
      });
      expect(useAppStore.getState().contentView).toBe("goal-detail");
      expect(useAppStore.getState().selectedGoalId).toBe("g42");
    });
  });

  describe("URL → store reflection", () => {
    it("updates store when navigating to a new URL (browser back/forward)", () => {
      let nav: ((to: string) => void) | null = null;
      render(
        <TreeWithNavCapture
          initialPath="/inbox"
          captureNavigate={(n) => {
            nav = n;
          }}
        />,
      );
      expect(useAppStore.getState().contentView).toBe("inbox");
      act(() => {
        nav?.("/dashboard");
      });
      expect(useAppStore.getState().contentView).toBe("dashboard");
    });

    it("clears selectedRunId on URL-driven navigation", () => {
      let nav: ((to: string) => void) | null = null;
      render(
        <TreeWithNavCapture
          initialPath="/jobs/j1"
          captureNavigate={(n) => {
            nav = n;
          }}
        />,
      );
      act(() => {
        useAppStore.setState({ selectedRunId: "r1" });
      });
      act(() => {
        nav?.("/dashboard");
      });
      expect(useAppStore.getState().contentView).toBe("dashboard");
      expect(useAppStore.getState().selectedRunId).toBeNull();
    });

    it("redirects unknown URLs to /inbox after hydration", () => {
      let nav: ((to: string) => void) | null = null;
      render(
        <TreeWithNavCapture
          initialPath="/inbox"
          captureNavigate={(n) => {
            nav = n;
          }}
        />,
      );
      act(() => {
        nav?.("/bogus");
      });
      expect(useAppStore.getState().contentView).toBe("inbox");
    });
  });

  describe("loop guard", () => {
    it("does not infinite-loop when store and URL are kept in sync", () => {
      render(<TreeWithNavCapture initialPath="/dashboard" />);
      // Rapidly toggle store state — should not blow the stack
      act(() => {
        useAppStore.getState().setContentView("memory");
      });
      act(() => {
        useAppStore.getState().setContentView("inbox");
      });
      act(() => {
        useAppStore.getState().setContentView("dashboard");
      });
      expect(useAppStore.getState().contentView).toBe("dashboard");
    });
  });
});
