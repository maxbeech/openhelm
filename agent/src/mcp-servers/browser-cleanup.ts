/**
 * Agent-side cleanup for orphaned Chrome browser processes.
 *
 * Two cleanup strategies:
 *
 * 1. **PID-file based** — The browser MCP server tracks Chrome PIDs in
 *    per-run files at ~/.openhelm/browser-pids/run-{runId}.json. After a
 *    run finishes the agent reads the file and kills survivors.
 *
 * 2. **Process-scan based** — Scans `ps` output for Chrome processes
 *    launched with nodriver temp user-data-dirs (`uc_*` prefix) and a
 *    `--remote-debugging-port` flag. This catches instances whose PID was
 *    tracked incorrectly (e.g. Python MCP server PID instead of Chrome).
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
 * Find orphaned nodriver Chrome processes by scanning `ps` output.
 *
 * Matches Chrome main processes (not Helper/renderer sub-processes) that
 * have a `user-data-dir` inside a temp directory with the `uc_` prefix
 * (nodriver's signature) AND a `--remote-debugging-port` flag.
 *
 * @param excludePids PIDs to skip (e.g. from a currently active run).
 */
function findOrphanedNodriverPids(excludePids?: Set<number>): number[] {
  try {
    // Get all Chrome main processes with their full command lines
    const out = execFileSync(
      "ps",
      ["axo", "pid,args"],
      { encoding: "utf-8", timeout: 5000 },
    );

    const orphans: number[] = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Must be a Chrome/Chromium main process (not Helper/renderer)
      const lower = trimmed.toLowerCase();
      if (!CHROME_NAMES.some((n) => lower.includes(n))) continue;
      if (lower.includes("helper") || lower.includes("crashpad")) continue;

      // Must have a nodriver temp user-data-dir (uc_ prefix in temp path)
      if (!/user-data-dir=\S*\/uc_/.test(trimmed)) continue;

      // Must have remote-debugging-port (confirms automation instance)
      if (!trimmed.includes("--remote-debugging-port")) continue;

      // Extract PID (first token)
      const pid = parseInt(trimmed.split(/\s+/)[0], 10);
      if (isNaN(pid)) continue;
      if (excludePids?.has(pid)) continue;

      orphans.push(pid);
    }
    return orphans;
  } catch {
    return [];
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

/** Kill a list of PIDs with SIGTERM + delayed SIGKILL. */
function killPids(pids: number[]): number {
  let killed = 0;
  for (const pid of pids) {
    safeKill(pid, "SIGTERM");
    killed++;
  }
  if (killed > 0) {
    const copy = [...pids];
    setTimeout(() => {
      for (const pid of copy) {
        safeKill(pid, "SIGKILL");
      }
    }, 3000);
  }
  return killed;
}

/**
 * Kill any orphaned browser processes from a specific run.
 * Called in the executor's post-run cleanup phase.
 *
 * Uses both PID-file based cleanup AND process-scan cleanup to catch
 * instances whose PID was tracked incorrectly.
 *
 * NOTE: The process scan kills ALL nodriver Chrome processes on the
 * machine. This is safe when executor concurrency is 1 (the default).
 * If concurrency > 1 is ever used, this should be made run-aware.
 */
export function cleanupBrowsersForRun(runId: string): void {
  try {
    let killedFromFile = 0;
    const filePath = join(BROWSER_PIDS_DIR, `run-${runId}.json`);
    if (existsSync(filePath)) {
      killedFromFile = killPidsFromFile(filePath);
    }

    // Scan for orphaned nodriver Chrome processes as a fallback.
    // This catches instances whose PID was incorrectly recorded.
    const orphans = findOrphanedNodriverPids();
    const killedFromScan = killPids(orphans);

    const total = killedFromFile + killedFromScan;
    if (total > 0) {
      console.error(
        `[browser-cleanup] killed ${total} orphaned Chrome process(es) from run ${runId}` +
          (killedFromScan > 0 ? ` (${killedFromScan} via process scan)` : ""),
      );
    }
  } catch (err) {
    console.error("[browser-cleanup] post-run cleanup error (non-fatal):", err);
  }
}

/**
 * Sweep all orphaned browser PID files from ~/.openhelm/browser-pids/
 * AND scan for orphaned nodriver Chrome processes.
 * Called at agent startup to clean up after crashes.
 */
export function cleanupOrphanedBrowserPids(): void {
  try {
    let totalKilled = 0;

    // 1. PID-file based cleanup
    if (existsSync(BROWSER_PIDS_DIR)) {
      const files = readdirSync(BROWSER_PIDS_DIR);
      for (const file of files) {
        if (file.startsWith("run-") && file.endsWith(".json")) {
          totalKilled += killPidsFromFile(join(BROWSER_PIDS_DIR, file));
        }
      }
    }

    // 2. Process-scan fallback — catch any nodriver Chrome processes that
    //    escaped PID-file tracking entirely.
    const orphans = findOrphanedNodriverPids();
    const scannedKilled = killPids(orphans);
    totalKilled += scannedKilled;

    if (totalKilled > 0) {
      console.error(
        `[browser-cleanup] startup sweep: killed ${totalKilled} orphaned Chrome process(es)` +
          (scannedKilled > 0 ? ` (${scannedKilled} via process scan)` : ""),
      );
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}
