/**
 * UsageService — orchestrates periodic Claude Code token usage tracking.
 *
 * On each refresh():
 *   1. Reads ~/.claude/projects JSONL files (last 9 days)
 *   2. Cross-references with OpenHelm session IDs from our runs table
 *   3. UPSERTs per-day snapshots into claude_usage_snapshots
 *   4. Checks configured alert thresholds and fires macOS notifications for new ones
 *   5. Emits "usage.updated" IPC event so the frontend can refresh
 */

import { readClaudeUsageByDate } from "./reader.js";
import {
  upsertUsageSnapshot,
  listUsageSnapshots,
  pruneUsageSnapshots,
  getOpenhelmSessionIdsByDates,
} from "../db/queries/usage.js";
import { getSetting, setSetting } from "../db/queries/settings.js";
import { emit } from "../ipc/emitter.js";
import type { UsageSummary, UsagePeriodStat, UsageDayPoint, ClaudeUsageSnapshot } from "@openhelm/shared";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the last N UTC dates (YYYY-MM-DD), today first */
function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Returns the Monday of the ISO week containing the given UTC date string */
function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun 6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Returns the ISO week string YYYY-Www for a UTC date string */
function isoWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  // Algorithm: find Thursday of the week, then compute week number
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Build a zero UsagePeriodStat */
function zeroPeriod(): UsagePeriodStat {
  return { totalTokens: 0, sonnetTokens: 0, openHelmTokens: 0 };
}

/** Sum tokens from a list of snapshots into a UsagePeriodStat */
function sumSnapshots(snapshots: ClaudeUsageSnapshot[]): UsagePeriodStat {
  let total = 0, sonnet = 0, openHelm = 0;
  for (const s of snapshots) {
    total += s.totalInputTokens + s.totalOutputTokens;
    sonnet += s.sonnetInputTokens + s.sonnetOutputTokens;
    openHelm += s.openHelmInputTokens + s.openHelmOutputTokens;
  }
  return { totalTokens: total, sonnetTokens: sonnet, openHelmTokens: openHelm };
}

// ─── Alert logic ─────────────────────────────────────────────────────────────

const ALERT_THRESHOLDS = [50, 75, 90] as const;

interface AlertCheck {
  metric: "daily" | "weekly_all" | "weekly_sonnet";
  period: string; // YYYY-MM-DD or YYYY-Www
  current: number;
  budget: number;
}

async function maybeSendAlerts(checks: AlertCheck[]): Promise<void> {
  for (const check of checks) {
    const pct = Math.floor((check.current / check.budget) * 100);
    for (const threshold of ALERT_THRESHOLDS) {
      if (pct < threshold) continue;

      const key = `usage_alert.${check.metric}.${check.period}.${threshold}` as Parameters<typeof setSetting>[0];
      const existing = getSetting(key as Parameters<typeof getSetting>[0]);
      if (existing) continue; // already sent for this period+threshold

      // Mark as sent before firing (prevents race on re-entry)
      setSetting(key as Parameters<typeof setSetting>[0], new Date().toISOString());

      const label =
        check.metric === "daily"
          ? "today"
          : check.metric === "weekly_all"
          ? "this week (all models)"
          : "this week (Sonnet)";

      const used = check.current.toLocaleString();
      const budget = check.budget.toLocaleString();
      const remaining = check.budget - check.current;
      const body =
        `You've used ${threshold}% of your ${label} Claude Code budget ` +
        `(${used} / ${budget} tokens). ~${remaining.toLocaleString()} tokens remaining.`;

      await sendUsageNotification(`Token usage at ${threshold}%`, body);
    }
  }
}

async function sendUsageNotification(title: string, body: string): Promise<void> {
  try {
    // Runtime check: Tauri invoke only available in desktop app context
    const tauriModule = await import("@tauri-apps/api/core").catch(() => null);
    if (!tauriModule) return;
    await tauriModule.invoke("send_notification", { title, body });
  } catch {
    // Not in Tauri context (dev mode) — silently skip
  }
}

// ─── Main service ─────────────────────────────────────────────────────────────

export class UsageService {
  private refreshing = false;

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this._doRefresh();
    } catch (err) {
      console.error("[usage] refresh error:", err);
    } finally {
      this.refreshing = false;
    }
  }

  private async _doRefresh(): Promise<void> {
    const dates = lastNDates(9); // today + last 8 days
    const today = dates[0];

    // 1. Read JSONL data (total Claude Code usage)
    const jsonlByDate = await readClaudeUsageByDate();
    const hasJsonl = jsonlByDate.size > 0;

    // 2. Get OpenHelm session IDs per day for cross-referencing
    const ohSessionsByDate = getOpenhelmSessionIdsByDates(dates);

    // 3. Compute OpenHelm token sub-totals from JSONL session cross-reference
    //    (more accurate than using runs table alone, as it captures exact tokens
    //     as reported by Claude Code for our sessions)
    //    Fallback: use JSONL daily total with a 0 openhelm figure when session
    //    IDs don't match (i.e. old runs without sessionId)
    const ohTotalByDate = new Map<string, { input: number; output: number }>();
    for (const date of dates) {
      const ohSessions = ohSessionsByDate.get(date) ?? new Set<string>();
      const jsonl = jsonlByDate.get(date);
      // We'll compute openHelm tokens from the DB runs table (more reliable)
      // and use JSONL only for total. OpenHelm DB tokens already track per run.
      ohTotalByDate.set(date, { input: 0, output: 0 }); // placeholder, filled below
      void ohSessions; void jsonl;
    }

    // Get OpenHelm totals from runs table (source of truth for our runs)
    const { getOpenhelmTokensByDates } = await import("../db/queries/usage.js");
    const ohRows = getOpenhelmTokensByDates(dates);
    for (const row of ohRows) {
      ohTotalByDate.set(row.date, { input: row.inputTokens, output: row.outputTokens });
    }

    // 4. UPSERT snapshots for each date
    const now = new Date().toISOString();
    for (const date of dates) {
      const jsonl = jsonlByDate.get(date);
      const oh = ohTotalByDate.get(date) ?? { input: 0, output: 0 };

      upsertUsageSnapshot({
        date,
        recordedAt: now,
        totalInputTokens: jsonl ? jsonl.totalInputTokens : oh.input,
        totalOutputTokens: jsonl ? jsonl.totalOutputTokens : oh.output,
        sonnetInputTokens: jsonl?.sonnetInputTokens ?? 0,
        sonnetOutputTokens: jsonl?.sonnetOutputTokens ?? 0,
        openHelmInputTokens: oh.input,
        openHelmOutputTokens: oh.output,
      });
    }

    // Prune old rows
    pruneUsageSnapshots(35);

    // 5. Check alert thresholds
    const dailyBudgetStr = getSetting("claude_daily_budget" as Parameters<typeof getSetting>[0]);
    const weeklyBudgetStr = getSetting("claude_weekly_budget" as Parameters<typeof getSetting>[0]);
    const dailyBudget = dailyBudgetStr ? parseInt(dailyBudgetStr.value, 10) : null;
    const weeklyBudget = weeklyBudgetStr ? parseInt(weeklyBudgetStr.value, 10) : null;

    if (dailyBudget || weeklyBudget) {
      const snapshots = listUsageSnapshots(35);
      const todaySnap = snapshots.find((s) => s.date === today);
      const currentWeekStart = weekStart(today);
      const weekSnaps = snapshots.filter((s) => s.date >= currentWeekStart && s.date <= today);

      const checks: AlertCheck[] = [];

      if (dailyBudget && todaySnap) {
        const todayTotal = todaySnap.totalInputTokens + todaySnap.totalOutputTokens;
        checks.push({ metric: "daily", period: today, current: todayTotal, budget: dailyBudget });
      }

      if (weeklyBudget && weekSnaps.length > 0) {
        const weekTotal = weekSnaps.reduce((s, snap) => s + snap.totalInputTokens + snap.totalOutputTokens, 0);
        const weekSonnet = weekSnaps.reduce((s, snap) => s + snap.sonnetInputTokens + snap.sonnetOutputTokens, 0);
        const weekKey = isoWeek(today);
        checks.push({ metric: "weekly_all", period: weekKey, current: weekTotal, budget: weeklyBudget });
        checks.push({ metric: "weekly_sonnet", period: weekKey, current: weekSonnet, budget: weeklyBudget });
      }

      await maybeSendAlerts(checks);
    }

    // 6. Notify frontend
    emit("usage.updated", { dataSource: hasJsonl ? "jsonl" : "openhelm_only" });
  }

  /** Build UsageSummary from current snapshot data for the IPC handler */
  getUsageSummary(): UsageSummary {
    const snapshots = listUsageSnapshots(35);
    const today = new Date().toISOString().slice(0, 10);
    const currentWeekStart = weekStart(today);

    // Previous period references
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const prevWeekStart = weekStart(sevenDaysAgo);
    const prevWeekEnd = new Date(
      new Date(currentWeekStart + "T00:00:00Z").getTime() - 86_400_000,
    ).toISOString().slice(0, 10);

    const byDate = new Map(snapshots.map((s) => [s.date, s]));

    // Today vs same day last week
    const todaySnap = byDate.get(today);
    const prevDaySnap = byDate.get(sevenDaysAgo);

    // This week (Mon → today) vs last week (Mon → same weekday)
    const weekSnaps = snapshots.filter((s) => s.date >= currentWeekStart && s.date <= today);
    const prevWeekDates = getDatesInRange(prevWeekStart, prevWeekEnd).slice(0, weekSnaps.length);
    const prevWeekSnaps = prevWeekDates
      .map((d) => byDate.get(d))
      .filter((s): s is ClaudeUsageSnapshot => s !== undefined);

    // 30-day series (ascending)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const series: UsageDayPoint[] = snapshots
      .filter((s) => s.date >= thirtyDaysAgo)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        date: s.date,
        totalTokens: s.totalInputTokens + s.totalOutputTokens,
        openHelmTokens: s.openHelmInputTokens + s.openHelmOutputTokens,
      }));

    const dailyBudgetStr = getSetting("claude_daily_budget" as Parameters<typeof getSetting>[0]);
    const weeklyBudgetStr = getSetting("claude_weekly_budget" as Parameters<typeof getSetting>[0]);

    const lastDataSource = snapshots.length > 0 &&
      (snapshots[0].totalInputTokens > snapshots[0].openHelmInputTokens ||
       snapshots[0].totalOutputTokens > snapshots[0].openHelmOutputTokens)
      ? "jsonl" as const
      : "openhelm_only" as const;

    return {
      today: todaySnap ? sumSnapshots([todaySnap]) : zeroPeriod(),
      todayPrev: prevDaySnap ? sumSnapshots([prevDaySnap]) : zeroPeriod(),
      week: sumSnapshots(weekSnaps),
      weekPrev: sumSnapshots(prevWeekSnaps),
      series,
      dailyBudget: dailyBudgetStr ? parseInt(dailyBudgetStr.value, 10) : null,
      weeklyBudget: weeklyBudgetStr ? parseInt(weeklyBudgetStr.value, 10) : null,
      dataSource: lastDataSource,
    };
  }
}

function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Singleton */
export const usageService = new UsageService();
