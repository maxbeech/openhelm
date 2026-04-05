/**
 * Low Token Mode store.
 *
 * Low token mode is a temporary runtime override that:
 * - Routes all job runs to Haiku (instead of the job's configured model)
 * - Downgrades high-effort jobs to medium effort
 * - Reduces recurring job frequency by ⅓ (1.5× interval)
 *
 * State is persisted to the agent's settings DB so the agent can read it
 * synchronously at run time. It does NOT modify job configs — toggling off
 * restores normal behaviour immediately.
 *
 * Auto-reset: if a weekly Claude Code budget reset time is configured, the
 * mode automatically disables itself when that time arrives.
 */

import { create } from "zustand";
import * as api from "@/lib/api";

interface LowTokenModeState {
  /** Whether low token mode is currently active */
  enabled: boolean;
  /** Day of week for weekly auto-reset (0=Sun…6=Sat), or null if not set */
  weeklyResetDow: number | null;
  /** Hour (0–23) for weekly auto-reset, or null if not set */
  weeklyResetHour: number | null;
  /** ISO timestamp of next scheduled auto-reset, or null */
  nextResetAt: string | null;
  /** True while loading initial state from agent */
  loading: boolean;

  /** Load state from the agent settings DB */
  load: () => Promise<void>;
  /** Enable or disable low token mode */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Persist the user's weekly Claude Code budget reset time */
  setWeeklyReset: (dow: number, hour: number) => Promise<void>;
  /** Clear the weekly reset configuration */
  clearWeeklyReset: () => Promise<void>;
}

/** Compute the next occurrence of a given day-of-week + hour from `from` (local time) */
function nextWeeklyOccurrence(dow: number, hour: number, from: Date): Date {
  const candidate = new Date(from);
  candidate.setHours(hour, 0, 0, 0);
  const currentDow = candidate.getDay();
  let daysToAdd = (dow - currentDow + 7) % 7;
  if (daysToAdd === 0 && candidate <= from) daysToAdd = 7;
  candidate.setDate(candidate.getDate() + daysToAdd);
  return candidate;
}

let autoResetTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoResetTimer() {
  if (autoResetTimer !== null) {
    clearTimeout(autoResetTimer);
    autoResetTimer = null;
  }
}

function scheduleAutoReset(nextResetAt: string) {
  clearAutoResetTimer();
  const delay = new Date(nextResetAt).getTime() - Date.now();
  if (delay <= 0) {
    // Already past — disable immediately
    void useLowTokenModeStore.getState().setEnabled(false);
    return;
  }
  autoResetTimer = setTimeout(() => {
    void useLowTokenModeStore.getState().setEnabled(false);
  }, delay);
}

export const useLowTokenModeStore = create<LowTokenModeState>((set, get) => ({
  enabled: false,
  weeklyResetDow: null,
  weeklyResetHour: null,
  nextResetAt: null,
  loading: true,

  load: async () => {
    try {
      const [ltmSetting, dowSetting, hourSetting] = await Promise.all([
        api.getSetting("low_token_mode"),
        api.getSetting("claude_weekly_reset_dow"),
        api.getSetting("claude_weekly_reset_hour"),
      ]);

      const enabled = ltmSetting?.value === "true";
      const weeklyResetDow = dowSetting ? parseInt(dowSetting.value, 10) : null;
      const weeklyResetHour = hourSetting ? parseInt(hourSetting.value, 10) : null;

      let nextResetAt: string | null = null;
      if (enabled && weeklyResetDow !== null && weeklyResetHour !== null) {
        nextResetAt = nextWeeklyOccurrence(weeklyResetDow, weeklyResetHour, new Date()).toISOString();
        scheduleAutoReset(nextResetAt);
      }

      set({ enabled, weeklyResetDow, weeklyResetHour, nextResetAt, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setEnabled: async (enabled) => {
    clearAutoResetTimer();
    const result = await api.setLowTokenMode({ enabled });
    const { weeklyResetDow, weeklyResetHour } = get();

    let nextResetAt: string | null = null;
    if (enabled && weeklyResetDow !== null && weeklyResetHour !== null) {
      nextResetAt = nextWeeklyOccurrence(weeklyResetDow, weeklyResetHour, new Date()).toISOString();
      scheduleAutoReset(nextResetAt);
    }

    set({ enabled: result.enabled, nextResetAt: result.nextResetAt ?? nextResetAt });
  },

  setWeeklyReset: async (dow, hour) => {
    await Promise.all([
      api.setSetting({ key: "claude_weekly_reset_dow", value: String(dow) }),
      api.setSetting({ key: "claude_weekly_reset_hour", value: String(hour) }),
    ]);

    const nextResetAt = get().enabled
      ? nextWeeklyOccurrence(dow, hour, new Date()).toISOString()
      : null;

    if (nextResetAt) scheduleAutoReset(nextResetAt);

    set({ weeklyResetDow: dow, weeklyResetHour: hour, nextResetAt });
  },

  clearWeeklyReset: async () => {
    await Promise.all([
      api.deleteSetting("claude_weekly_reset_dow"),
      api.deleteSetting("claude_weekly_reset_hour"),
    ]);
    clearAutoResetTimer();
    set({ weeklyResetDow: null, weeklyResetHour: null, nextResetAt: null });
  },
}));
