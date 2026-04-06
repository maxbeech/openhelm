/**
 * Autopilot Scanner — always-on proactive monitoring for OpenHelm.
 *
 * Two-tier architecture:
 *   Tier 1: Lightweight in-process scanner (this file)
 *     - Reads rules from Autopilot Rules table
 *     - Collects metrics via DB queries
 *     - Writes to Autopilot Metrics table
 *     - Evaluates targets → triggers Tier 2 on breach
 *
 *   Tier 2: Investigation jobs (see investigate.ts)
 *     - Spawned on demand under Autopilot Maintenance goal
 *     - Full Claude Code process with MCP access
 *
 * Follows the UsageService singleton pattern.
 */

import { getSetting } from "../db/queries/settings.js";
import { listProjects } from "../db/queries/projects.js";
import { listTargets } from "../db/queries/targets.js";
import { evaluateTargets } from "../data-tables/target-evaluator.js";
import { getAutopilotMode } from "./index.js";
import { ensureSystemEntities } from "./seeder.js";
import {
  getEnabledRules,
  collectMetrics,
  writeMetricsRow,
  pruneOldMetricsRows,
} from "./metrics.js";
import { spawnInvestigation, isOnCooldown } from "./investigate.js";
import { emit } from "../ipc/emitter.js";

const DEFAULT_INTERVAL_MS = 30 * 60_000; // 30 minutes
const INITIAL_DELAY_MS = 60_000; // 1 minute delay on startup
const PRUNE_RETENTION_DAYS = 30;
const MAX_INVESTIGATIONS_PER_PROJECT = 3;

class AutopilotScanner {
  private scanning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startupTimerId: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  /** Start the autopilot scanner loop. */
  start(): void {
    if (this._started) return;
    this._started = true;

    console.error("[autopilot] starting scanner (initial scan in 60s)");

    // Initial delayed scan
    this.startupTimerId = setTimeout(() => {
      this.scan();
      // Then schedule recurring scans
      this.intervalId = setInterval(
        () => this.scan(),
        this.getIntervalMs(),
      );
    }, INITIAL_DELAY_MS);
  }

  /** Stop the autopilot scanner loop. */
  stop(): void {
    if (this.startupTimerId) {
      clearTimeout(this.startupTimerId);
      this.startupTimerId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._started = false;
    console.error("[autopilot] scanner stopped");
  }

  /**
   * Restart the recurring interval with the current setting value.
   * Call this after the user changes `autopilot_scan_interval_minutes`.
   */
  updateInterval(): void {
    if (!this._started) return;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    const ms = this.getIntervalMs();
    this.intervalId = setInterval(() => this.scan(), ms);
    console.error(`[autopilot] scanner interval updated to ${ms / 60_000}min`);
  }

  /** Trigger an immediate scan (e.g., from IPC). */
  async forceScan(): Promise<void> {
    await this.scan();
  }

  /** Main scan loop — iterates all projects. */
  private async scan(): Promise<void> {
    if (this.scanning) return;

    const mode = getAutopilotMode();
    if (mode === "off") return;

    this.scanning = true;
    try {
      const projects = listProjects();
      for (const project of projects) {
        try {
          await this.scanProject(project.id);
        } catch (err) {
          console.error(`[autopilot] scan failed for project ${project.id}:`, err);
        }
      }
      emit("autopilot.scanComplete", { timestamp: new Date().toISOString() });
    } catch (err) {
      console.error("[autopilot] scan error:", err);
    } finally {
      this.scanning = false;
    }
  }

  /** Scan a single project — ensure entities, collect, write, evaluate. */
  private async scanProject(projectId: string): Promise<void> {
    // 1. Ensure system entities exist (idempotent)
    const { systemGoal, rulesTable, metricsTable } =
      ensureSystemEntities(projectId);

    // 2. Read enabled rules
    const rules = getEnabledRules(rulesTable);
    if (rules.length === 0) return;

    // 3. Collect current metric values (pure DB queries)
    const values = collectMetrics(projectId, rules);

    // 4. Write row to metrics table
    writeMetricsRow(metricsTable, values);

    // 5. Prune old rows
    pruneOldMetricsRows(metricsTable, PRUNE_RETENTION_DAYS);

    // 6. Evaluate targets on the metrics table
    const targets = listTargets({ goalId: systemGoal.id });
    if (targets.length === 0) return;

    const evaluations = evaluateTargets(targets);
    const breaches = evaluations.filter((e) => !e.met);

    if (breaches.length === 0) return;

    // 7. For each breach, check cooldown and spawn investigation
    let activeInvestigations = 0;
    for (const breach of breaches) {
      if (activeInvestigations >= MAX_INVESTIGATIONS_PER_PROJECT) break;

      // Find the rule that corresponds to this target
      const target = targets.find((t) => t.id === breach.targetId);
      if (!target) continue;

      // Match target to rule via column ID
      const rule = rules.find(
        (r) => `col_${r.metricColumn}` === target.columnId,
      );
      if (!rule) continue;

      if (isOnCooldown(rule.metricColumn, projectId)) continue;

      try {
        await spawnInvestigation(
          projectId,
          systemGoal.id,
          rule,
          breach,
          values,
        );
        activeInvestigations++;
      } catch (err) {
        console.error(
          `[autopilot] failed to spawn investigation for ${rule.ruleName}:`,
          err,
        );
      }
    }
  }

  /** Get the scan interval from settings (default 30 min). */
  private getIntervalMs(): number {
    const setting = getSetting("autopilot_scan_interval_minutes");
    if (setting?.value) {
      const mins = parseInt(setting.value, 10);
      if (!Number.isNaN(mins) && mins >= 15) {
        return mins * 60_000;
      }
    }
    return DEFAULT_INTERVAL_MS;
  }
}

/** Singleton autopilot scanner instance. */
export const autopilotScanner = new AutopilotScanner();
