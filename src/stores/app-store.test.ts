import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app-store";

describe("AppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      contentView: "home",
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
      runsPanelOpen: true,
      collapsedGoalIds: [],
      page: "goals",
      filter: {},
      activeProjectId: null,
      onboardingComplete: false,
      agentReady: false,
    });
  });

  // New navigation model tests
  it("selectGoal sets goal-detail view", () => {
    useAppStore.getState().selectGoal("g1");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("goal-detail");
    expect(s.selectedGoalId).toBe("g1");
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedRunId).toBeNull();
  });

  it("selectJob sets job-detail view", () => {
    useAppStore.getState().selectJob("j1");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("job-detail");
    expect(s.selectedJobId).toBe("j1");
    expect(s.selectedRunId).toBeNull();
  });

  it("selectRun sets run-detail view and preserves jobId", () => {
    useAppStore.getState().selectJob("j1");
    useAppStore.getState().selectRun("r1");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("run-detail");
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedJobId).toBe("j1"); // preserved from prior selectJob
  });

  it("selectRun with explicit jobId sets selectedJobId", () => {
    useAppStore.getState().selectRun("r1", "j2");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("run-detail");
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedJobId).toBe("j2");
  });

  it("toggleRunsPanel toggles state", () => {
    expect(useAppStore.getState().runsPanelOpen).toBe(true);
    useAppStore.getState().toggleRunsPanel();
    expect(useAppStore.getState().runsPanelOpen).toBe(false);
    useAppStore.getState().toggleRunsPanel();
    expect(useAppStore.getState().runsPanelOpen).toBe(true);
  });

  it("toggleGoalCollapsed adds and removes goal IDs", () => {
    useAppStore.getState().toggleGoalCollapsed("g1");
    expect(useAppStore.getState().collapsedGoalIds).toEqual(["g1"]);
    useAppStore.getState().toggleGoalCollapsed("g2");
    expect(useAppStore.getState().collapsedGoalIds).toEqual(["g1", "g2"]);
    useAppStore.getState().toggleGoalCollapsed("g1");
    expect(useAppStore.getState().collapsedGoalIds).toEqual(["g2"]);
  });

  it("setContentView navigates to settings", () => {
    useAppStore.getState().setContentView("settings");
    expect(useAppStore.getState().contentView).toBe("settings");
  });

  it("setContentView to home clears selections", () => {
    useAppStore.getState().selectGoal("g1");
    useAppStore.getState().setContentView("home");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("home");
    expect(s.selectedGoalId).toBeNull();
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedRunId).toBeNull();
  });

  // Backward-compat setPage tests
  it("setPage maps goals to home", () => {
    useAppStore.getState().setPage("goals");
    expect(useAppStore.getState().contentView).toBe("home");
  });

  it("setPage maps runs with runId filter to run-detail", () => {
    useAppStore.getState().setPage("runs", { runId: "r1" });
    const s = useAppStore.getState();
    expect(s.contentView).toBe("run-detail");
    expect(s.selectedRunId).toBe("r1");
  });

  it("setPage maps settings", () => {
    useAppStore.getState().setPage("settings");
    expect(useAppStore.getState().contentView).toBe("settings");
  });

  // Existing behavior
  it("sets active project ID and resets to home", () => {
    useAppStore.getState().selectGoal("g1");
    useAppStore.getState().setActiveProjectId("p1");
    const s = useAppStore.getState();
    expect(s.activeProjectId).toBe("p1");
    expect(s.contentView).toBe("home");
    expect(s.selectedGoalId).toBeNull();
  });

  it("sets onboarding complete", () => {
    useAppStore.getState().setOnboardingComplete(true);
    expect(useAppStore.getState().onboardingComplete).toBe(true);
  });

  it("sets agent ready", () => {
    useAppStore.getState().setAgentReady(true);
    expect(useAppStore.getState().agentReady).toBe(true);
  });

  it("defaults to home content view", () => {
    expect(useAppStore.getState().contentView).toBe("home");
  });
});
