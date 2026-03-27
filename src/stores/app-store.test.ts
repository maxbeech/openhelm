import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app-store";

describe("AppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      contentView: "dashboard",
      selectedGoalId: null,
      selectedJobId: null,
      selectedRunId: null,
      collapsedGoalIds: [],
      page: "goals",
      filter: {},
      activeProjectId: null,
      onboardingComplete: false,
      agentReady: false,
    });
  });

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

  it("selectRun sets selectedRunId and preserves jobId", () => {
    useAppStore.getState().selectJob("j1");
    useAppStore.getState().selectRun("r1");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("job-detail");
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedJobId).toBe("j1");
  });

  it("selectRun with explicit jobId sets selectedJobId and switches to job-detail", () => {
    useAppStore.getState().selectRun("r1", "j2");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("job-detail");
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedJobId).toBe("j2");
  });

  it("clearSelectedRun clears the run selection", () => {
    useAppStore.getState().selectJob("j1");
    useAppStore.getState().selectRun("r1");
    useAppStore.getState().clearSelectedRun();
    const s = useAppStore.getState();
    expect(s.selectedRunId).toBeNull();
    expect(s.selectedJobId).toBe("j1");
    expect(s.contentView).toBe("job-detail");
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

  it("setContentView to dashboard clears selections", () => {
    useAppStore.getState().selectGoal("g1");
    useAppStore.getState().setContentView("dashboard");
    const s = useAppStore.getState();
    expect(s.contentView).toBe("dashboard");
    expect(s.selectedGoalId).toBeNull();
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedRunId).toBeNull();
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

  it("setPage maps runs with runId filter and sets selectedRunId", () => {
    useAppStore.getState().selectJob("j1");
    useAppStore.getState().setPage("runs", { runId: "r1" });
    const s = useAppStore.getState();
    expect(s.selectedRunId).toBe("r1");
    expect(s.selectedJobId).toBe("j1");
    expect(s.contentView).toBe("job-detail");
  });

  it("setPage maps settings", () => {
    useAppStore.getState().setPage("settings");
    expect(useAppStore.getState().contentView).toBe("settings");
  });

  // Project switching
  it("sets active project ID and clears selections but preserves contentView", () => {
    useAppStore.getState().selectGoal("g1");
    useAppStore.getState().setActiveProjectId("p1");
    const s = useAppStore.getState();
    expect(s.activeProjectId).toBe("p1");
    expect(s.selectedGoalId).toBeNull();
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedRunId).toBeNull();
  });

  it("sets activeProjectId to null for All Projects", () => {
    useAppStore.getState().setActiveProjectId("p1");
    useAppStore.getState().setActiveProjectId(null);
    expect(useAppStore.getState().activeProjectId).toBeNull();
  });

  it("sets onboarding complete", () => {
    useAppStore.getState().setOnboardingComplete(true);
    expect(useAppStore.getState().onboardingComplete).toBe(true);
  });

  it("sets agent ready", () => {
    useAppStore.getState().setAgentReady(true);
    expect(useAppStore.getState().agentReady).toBe(true);
  });

  it("defaults to dashboard content view", () => {
    expect(useAppStore.getState().contentView).toBe("dashboard");
  });
});
