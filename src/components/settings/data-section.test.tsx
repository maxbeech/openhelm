import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataSection } from "./data-section";

// Mock the API module
vi.mock("@/lib/api", () => ({
  getExportStats: vi.fn().mockResolvedValue({
    totalRecords: 100,
    runLogCount: 50,
    estimatedSizeWithLogs: 100000,
    estimatedSizeWithoutLogs: 50000,
  }),
  exportData: vi.fn().mockResolvedValue({ success: true }),
  previewImport: vi.fn().mockResolvedValue({
    valid: true,
    version: 1,
    exportedAt: "2026-03-17T00:00:00.000Z",
    appVersion: "0.1.0",
    includesRunLogs: false,
    recordCounts: { projects: 1, goals: 1, jobs: 2, runs: 5, runLogs: 0, conversations: 0, messages: 0, dashboardItems: 0, memories: 0, runMemories: 0, settings: 3 },
    fileSizeBytes: 5000,
  }),
  executeImport: vi.fn().mockResolvedValue({
    success: true,
    recordCounts: { projects: 1, goals: 1, jobs: 2, runs: 5, runLogs: 0, conversations: 0, messages: 0, dashboardItems: 0, memories: 0, runMemories: 0, settings: 3 },
    invalidPaths: [],
    skippedSettings: [],
  }),
  fixProjectPath: vi.fn().mockResolvedValue({}),
}));

// Mock Tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("/tmp/export.json"),
  open: vi.fn().mockResolvedValue("/tmp/import.json"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DataSection", () => {
  it("renders export and import buttons", () => {
    render(<DataSection />);
    expect(screen.getByText("Export Data")).toBeInTheDocument();
    expect(screen.getByText("Import Data")).toBeInTheDocument();
  });

  it("renders data management heading", () => {
    render(<DataSection />);
    expect(screen.getByText("Data Management")).toBeInTheDocument();
  });

  it("renders include run logs checkbox", () => {
    render(<DataSection />);
    expect(screen.getByText(/Include run logs/)).toBeInTheDocument();
  });

  it("renders import warning text", () => {
    render(<DataSection />);
    expect(screen.getByText(/replace all existing data/)).toBeInTheDocument();
  });
});
