/**
 * Agent-side cleanup for orphaned Chrome browser processes.
 *
 * The browser MCP server tracks Chrome PIDs in per-run files at
 * ~/.openhelm/browser-pids/run-{runId}.json. When a run finishes, the
 * MCP server's own cleanup may not complete (e.g. SIGKILL race), so the
 * agent reads the PID file and kills any surviving Chrome processes.
 */

import { readFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

const BROWSER_PIDS_DIR = join(
  process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
  "browser-pids",
);

const CHROME_NAMES = ["chrome", "chromium", "msedge", "google chrome"];

/** Check whether a PID belongs to a Chrome/Chromium process. */
function isChromePid(pid: number): boolean {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    const lower = out.toLowerCase();
    return CHROME_NAMES.some((name) => lower.includes(name));
  } catch {
    // Process already dead or ps failed — not Chrome
    return false;
  }
}

/** Send a signal to a PID, ignoring errors (process may already be dead). */
function safeKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH = process already dead — expected
  }
}

/**
 * Read a PID file, kill surviving Chrome processes, and delete the file.
 * Returns the number of processes that received SIGTERM.
 */
function killPidsFromFile(filePath: string): number {
  let pidsToKill: number[] = [];

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const procs: Record<string, number> = data?.browser_processes ?? {};
    for (const pid of Object.values(procs)) {
      if (typeof pid === "number" && isChromePid(pid)) {
        pidsToKill.push(pid);
      }
    }
  } catch {
    // Malformed or unreadable file — just delete it
  }

  // Send SIGTERM to all verified Chrome PIDs
  for (const pid of pidsToKill) {
    safeKill(pid, "SIGTERM");
  }

  // Schedule SIGKILL fallback (non-blocking)
  if (pidsToKill.length > 0) {
    const pids = [...pidsToKill];
    setTimeout(() => {
      for (const pid of pids) {
        safeKill(pid, "SIGKILL");
      }
    }, 3000);
  }

  // Delete the PID file
  try {
    unlinkSync(filePath);
  } catch {
    // Already gone
  }

  return pidsToKill.length;
}

/**
 * Kill any orphaned browser processes from a specific run.
 * Called in the executor's post-run cleanup phase.
 */
export function cleanupBrowsersForRun(runId: string): void {
  try {
    const filePath = join(BROWSER_PIDS_DIR, `run-${runId}.json`);
    if (!existsSync(filePath)) return;

    const killed = killPidsFromFile(filePath);
    if (killed > 0) {
      console.error(
        `[browser-cleanup] killed ${killed} orphaned Chrome process(es) from run ${runId}`,
      );
    }
  } catch (err) {
    console.error("[browser-cleanup] post-run cleanup error (non-fatal):", err);
  }
}

/**
 * Sweep all orphaned browser PID files from ~/.openhelm/browser-pids/.
 * Called at agent startup to clean up after crashes.
 */
export function cleanupOrphanedBrowserPids(): void {
  try {
    if (!existsSync(BROWSER_PIDS_DIR)) return;

    const files = readdirSync(BROWSER_PIDS_DIR);
    let totalKilled = 0;

    for (const file of files) {
      if (file.startsWith("run-") && file.endsWith(".json")) {
        totalKilled += killPidsFromFile(join(BROWSER_PIDS_DIR, file));
      }
    }

    if (totalKilled > 0) {
      console.error(
        `[browser-cleanup] startup sweep: killed ${totalKilled} orphaned Chrome process(es)`,
      );
    } else if (files.length > 0) {
      console.error(
        `[browser-cleanup] startup sweep: cleaned ${files.length} stale PID file(s)`,
      );
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}
