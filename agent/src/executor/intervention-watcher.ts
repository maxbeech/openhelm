/**
 * Watches ~/.openhelm/interventions/ for CAPTCHA help request files written
 * by the browser MCP server. When found, creates a dashboard alert and
 * sends a native notification so the user can solve the CAPTCHA.
 */

import { readdirSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createDashboardItem, resolveDashboardItem } from "../db/queries/dashboard-items.js";
import { emit } from "../ipc/emitter.js";

const POLL_INTERVAL_MS = 5_000;

/** Resolved at call time so env var overrides work in tests. */
function getInterventionsDir(): string {
  return join(
    process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
    "interventions",
  );
}

interface InterventionRequest {
  id: string;
  runId: string | null;
  reason: string;
  screenshotPath: string | null;
  pageUrl: string;
  timestamp: string;
}

export class InterventionWatcher {
  private runId: string;
  private jobId: string;
  private projectId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processed = new Set<string>();
  /** IDs of dashboard items created by this watcher — auto-dismissed on stop(). */
  private createdItemIds: string[] = [];

  constructor(runId: string, jobId: string, projectId: string) {
    this.runId = runId;
    this.jobId = jobId;
    this.projectId = projectId;
  }

  start(): void {
    if (this.timer) return;
    mkdirSync(getInterventionsDir(), { recursive: true });
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** Returns true if this watcher created any CAPTCHA alerts (may still be open). */
  hasOpenItems(): boolean {
    return this.createdItemIds.length > 0;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Do NOT auto-dismiss CAPTCHA alerts — they must persist until the user
    // manually resolves them. The user may not have seen the notification yet,
    // and the browser may still be open for them to solve the CAPTCHA.
    this.createdItemIds = [];
    // Clean up any remaining intervention request files for this run
    this.cleanupRunFiles();
  }

  private poll(): void {
    let files: string[];
    try {
      files = readdirSync(getInterventionsDir());
    } catch {
      return; // Directory may not exist yet
    }

    for (const file of files) {
      if (!file.startsWith("req-") || !file.endsWith(".json")) continue;
      if (this.processed.has(file)) continue;

      const filePath = join(getInterventionsDir(), file);
      let request: InterventionRequest;
      try {
        const raw = readFileSync(filePath, "utf-8");
        request = JSON.parse(raw);
      } catch {
        continue; // Corrupted or being written — skip this tick
      }

      // Only process requests for this run
      if (request.runId !== this.runId) continue;

      this.processed.add(file);

      // Create dashboard alert
      const item = createDashboardItem({
        runId: this.runId,
        jobId: this.jobId,
        projectId: this.projectId,
        type: "captcha_intervention",
        title: `CAPTCHA detected — manual solve needed`,
        message: request.reason,
      });

      this.createdItemIds.push(item.id);
      emit("dashboard.created", item);
      // Emit a dedicated event so the frontend can show a persistent/urgent notification
      emit("intervention.captchaRequired", {
        runId: this.runId,
        jobId: this.jobId,
        projectId: this.projectId,
        reason: request.reason,
        pageUrl: request.pageUrl,
        screenshotPath: request.screenshotPath,
        dashboardItemId: item.id,
      });
      console.error(`[intervention] dashboard alert created for run ${this.runId}: ${request.reason}`);

      // Remove the request file (consumed)
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore — file may already be removed
      }

      // Also clean up the screenshot file reference (dashboard has the info)
      // Screenshot file is left for potential UI display
    }
  }

  private cleanupRunFiles(): void {
    try {
      const files = readdirSync(getInterventionsDir());
      for (const file of files) {
        if (!file.startsWith("req-") && !file.startsWith("screenshot-")) continue;
        const filePath = join(getInterventionsDir(), file);
        try {
          // For request files, check if they belong to this run
          if (file.startsWith("req-") && file.endsWith(".json")) {
            const raw = readFileSync(filePath, "utf-8");
            const data = JSON.parse(raw);
            if (data.runId === this.runId) {
              unlinkSync(filePath);
            }
          }
        } catch {
          // Ignore read/parse errors during cleanup
        }
      }
    } catch {
      // Directory doesn't exist — nothing to clean
    }
  }
}

/**
 * Remove all intervention files left behind by crashes.
 * Called at agent startup.
 */
export function cleanupOrphanedInterventions(): void {
  try {
    const files = readdirSync(getInterventionsDir());
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith("req-") || file.startsWith("screenshot-")) {
        try {
          unlinkSync(join(getInterventionsDir(), file));
          cleaned++;
        } catch {
          // ignore
        }
      }
    }
    if (cleaned > 0) {
      console.error(`[intervention] cleaned up ${cleaned} orphaned file(s)`);
    }
  } catch {
    // Directory doesn't exist — nothing to clean
  }
}
