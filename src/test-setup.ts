import "@testing-library/jest-dom/vitest";

// Mock Tauri APIs for testing
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock the agent client singleton
vi.mock("@/lib/agent-client", () => ({
  agentClient: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    request: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    isConnected: vi.fn().mockReturnValue(true),
  },
}));

// Mock Sentry frontend module — prevents real Sentry init in all frontend tests
vi.mock("@/lib/sentry", () => ({
  initFrontendSentry: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
  captureFrontendError: vi.fn(),
  addUserBreadcrumb: vi.fn(),
}));
