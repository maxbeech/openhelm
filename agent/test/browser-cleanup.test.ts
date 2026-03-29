import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "oh-browser-cleanup-test-"));
  process.env.OPENHELM_DATA_DIR = tempDir;
  // Reset module cache so BROWSER_PIDS_DIR picks up the new env var
  vi.resetModules();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.OPENHELM_DATA_DIR;
  vi.restoreAllMocks();
});

/** Write a fake PID file with the same format the MCP server produces. */
function writePidFile(runId: string, procs: Record<string, number>): string {
  const dir = join(tempDir, "browser-pids");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `run-${runId}.json`);
  writeFileSync(
    filePath,
    JSON.stringify({ browser_processes: procs, timestamp: Date.now() / 1000 }),
  );
  return filePath;
}

// Dynamic import to pick up env var each time (must be called after vi.resetModules)
async function loadModule() {
  return await import("../src/mcp-servers/browser-cleanup.js");
}

describe("cleanupBrowsersForRun", () => {
  it("does nothing when PID file does not exist", async () => {
    const { cleanupBrowsersForRun } = await loadModule();
    expect(() => cleanupBrowsersForRun("nonexistent-run")).not.toThrow();
  });

  it("deletes the PID file after processing", async () => {
    const filePath = writePidFile("del-test", {});
    expect(existsSync(filePath)).toBe(true);

    const { cleanupBrowsersForRun } = await loadModule();
    cleanupBrowsersForRun("del-test");

    expect(existsSync(filePath)).toBe(false);
  });

  it("handles malformed JSON gracefully", async () => {
    const dir = join(tempDir, "browser-pids");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "run-bad-json.json");
    writeFileSync(filePath, "not valid json");

    const { cleanupBrowsersForRun } = await loadModule();
    expect(() => cleanupBrowsersForRun("bad-json")).not.toThrow();
    // File should still be deleted
    expect(existsSync(filePath)).toBe(false);
  });

  it("handles empty browser_processes", async () => {
    writePidFile("empty", {});
    const { cleanupBrowsersForRun } = await loadModule();
    expect(() => cleanupBrowsersForRun("empty")).not.toThrow();
  });
});

describe("cleanupOrphanedBrowserPids", () => {
  it("does nothing when directory does not exist", async () => {
    const { cleanupOrphanedBrowserPids } = await loadModule();
    expect(() => cleanupOrphanedBrowserPids()).not.toThrow();
  });

  it("cleans up multiple PID files", async () => {
    writePidFile("a", {});
    writePidFile("b", {});
    writePidFile("c", {});

    const dir = join(tempDir, "browser-pids");
    expect(readdirSync(dir)).toHaveLength(3);

    const { cleanupOrphanedBrowserPids } = await loadModule();
    cleanupOrphanedBrowserPids();

    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("ignores non-matching files in the directory", async () => {
    const dir = join(tempDir, "browser-pids");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.txt"), "hello");
    writePidFile("x", {});

    const { cleanupOrphanedBrowserPids } = await loadModule();
    cleanupOrphanedBrowserPids();

    const remaining = readdirSync(dir);
    expect(remaining).toEqual(["readme.txt"]);
  });
});
