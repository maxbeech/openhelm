import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { registerHandler } from "../handler.js";
import {
  exportAll,
  getExportStats,
  clearAllData,
  importAllData,
  type ExportData,
} from "../../db/queries/export.js";
import { updateProject } from "../../db/queries/projects.js";
import { scheduler } from "../../scheduler/index.js";
import { executor } from "../../executor/index.js";
import { jobQueue } from "../../scheduler/queue.js";
import type {
  ExportParams,
  ExportResult,
  ImportParams,
  ImportPreviewResult,
  ImportExecuteParams,
  ImportResult,
  RecordCounts,
  FixProjectPathParams,
} from "@openhelm/shared";

const EXPORT_VERSION = 1;
const APP_VERSION = "0.1.0";
const MACHINE_SPECIFIC_SETTINGS = new Set([
  "claude_code_path",
  "claude_code_version",
]);

function countRecords(data: ExportData): RecordCounts {
  return {
    projects: data.projects.length,
    goals: data.goals.length,
    jobs: data.jobs.length,
    runs: data.runs.length,
    runLogs: data.runLogs.length,
    conversations: data.conversations.length,
    messages: data.messages.length,
    dashboardItems: data.dashboardItems.length,
    memories: data.memories.length,
    runMemories: data.runMemories.length,
    settings: data.settings.length,
  };
}

export function registerDataHandlers() {
  registerHandler("data.exportStats", () => {
    return getExportStats();
  });

  registerHandler("data.export", (params) => {
    const p = params as ExportParams;
    if (!p?.filePath) throw new Error("filePath is required");

    const data = exportAll(p.includeRunLogs);
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      includesRunLogs: p.includeRunLogs,
      ...data,
    };

    const json = JSON.stringify(payload, null, 2);
    writeFileSync(p.filePath, json, "utf-8");

    const stat = statSync(p.filePath);
    const result: ExportResult = {
      success: true,
      filePath: p.filePath,
      recordCounts: countRecords(data),
      fileSizeBytes: stat.size,
    };
    return result;
  });

  registerHandler("data.importPreview", (params) => {
    const p = params as ImportParams;
    if (!p?.filePath) throw new Error("filePath is required");

    const stat = statSync(p.filePath);
    try {
      const raw = readFileSync(p.filePath, "utf-8");
      const parsed = JSON.parse(raw);

      if (typeof parsed.version !== "number") {
        return { valid: false, error: "Invalid file: missing version", fileSizeBytes: stat.size } satisfies ImportPreviewResult;
      }
      if (parsed.version > EXPORT_VERSION) {
        return { valid: false, error: `Export version ${parsed.version} is newer than supported (${EXPORT_VERSION}). Please update OpenHelm.`, fileSizeBytes: stat.size } satisfies ImportPreviewResult;
      }

      const requiredKeys = ["projects", "goals", "jobs", "runs", "settings"];
      for (const key of requiredKeys) {
        if (!Array.isArray(parsed[key])) {
          return { valid: false, error: `Invalid file: missing or invalid "${key}" array`, fileSizeBytes: stat.size } satisfies ImportPreviewResult;
        }
      }

      const data = parsed as ExportData & { version: number; exportedAt: string; appVersion: string; includesRunLogs: boolean };
      const result: ImportPreviewResult = {
        valid: true,
        version: data.version,
        exportedAt: data.exportedAt,
        appVersion: data.appVersion,
        includesRunLogs: data.includesRunLogs ?? false,
        recordCounts: countRecords(data),
        fileSizeBytes: stat.size,
      };
      return result;
    } catch (err) {
      return { valid: false, error: `Failed to parse file: ${err instanceof Error ? err.message : String(err)}`, fileSizeBytes: stat.size } satisfies ImportPreviewResult;
    }
  });

  registerHandler("data.importExecute", (params) => {
    const p = params as ImportExecuteParams;
    if (!p?.filePath) throw new Error("filePath is required");

    // Block import during active runs
    if (executor.activeRunCount > 0 || jobQueue.size() > 0) {
      throw new Error("Cannot import while runs are active or queued. Cancel all runs first.");
    }

    // Read and parse
    const raw = readFileSync(p.filePath, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed.version !== EXPORT_VERSION) {
      throw new Error(`Unsupported export version: ${parsed.version}`);
    }

    const data = parsed as ExportData & { version: number };

    // Filter machine-specific settings — keep current values
    const skippedSettings = data.settings
      .filter((s) => MACHINE_SPECIFIC_SETTINGS.has(s.key))
      .map((s) => ({ key: s.key, reason: "Machine-specific setting preserved" }));
    data.settings = data.settings.filter((s) => !MACHINE_SPECIFIC_SETTINGS.has(s.key));

    // Normalize optional arrays
    data.runLogs = data.runLogs ?? [];
    data.conversations = data.conversations ?? [];
    data.messages = data.messages ?? [];
    data.dashboardItems = data.dashboardItems ?? [];
    data.memories = data.memories ?? [];
    data.runMemories = data.runMemories ?? [];

    // Stop scheduler, wipe, import, restart
    const wasRunning = scheduler.running;
    if (wasRunning) scheduler.stop();

    try {
      clearAllData();
      const recordCounts = importAllData(data);

      // Check project paths
      const invalidPaths = data.projects
        .filter((proj) => !existsSync(proj.directoryPath))
        .map((proj) => ({
          projectId: proj.id,
          projectName: proj.name,
          directoryPath: proj.directoryPath,
        }));

      const result: ImportResult = {
        success: true,
        recordCounts,
        invalidPaths,
        skippedSettings,
      };
      return result;
    } finally {
      if (wasRunning) scheduler.start();
    }
  });

  registerHandler("data.fixProjectPath", (params) => {
    const p = params as FixProjectPathParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.directoryPath) throw new Error("directoryPath is required");
    return updateProject({ id: p.id, directoryPath: p.directoryPath });
  });
}
