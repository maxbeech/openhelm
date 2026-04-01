/**
 * Wake Scheduler — schedules macOS wake events before upcoming Claude Code jobs.
 *
 * Architecture:
 *   1. On first enable, a sudoers entry is installed via a single osascript admin
 *      dialog. This grants passwordless `sudo pmset` to the current user.
 *   2. All subsequent pmset calls use plain `sudo pmset` — no dialogs ever.
 *   3. On disable, the sudoers entry is removed (one more admin dialog).
 *
 * Limitations:
 *   - macOS rounds wake times to the nearest 30 seconds
 *   - Lid-closed wake is unreliable; works best with lid open or in clamshell mode
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { listJobs } from "../db/queries/jobs.js";

const execFileAsync = promisify(execFile);

/** Lead time before job fires that we schedule the wake (ms). */
const WAKE_LEAD_MS = 2 * 60_000; // 2 minutes

/** Sudoers file that grants passwordless pmset access. */
const SUDOERS_FILE = "/etc/sudoers.d/openhelm-pmset";

/** In-memory map of jobId -> scheduled wake time (for cancellation). */
const scheduledWakes = new Map<string, Date>();

/**
 * Allowlist for usernames used in the osascript admin command.
 * Prevents shell injection if the environment variable contains unusual characters.
 * Note: macOS usernames may contain dots, hyphens, and underscores in addition to alphanumerics.
 * We do NOT use `id -un` or scutil here because both require additional privileges or
 * subprocess spawns that defeat the purpose of a quick env-var read.
 */
const SAFE_USERNAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Schedule a macOS wake event 2 minutes before the given fire time.
 * Replaces any existing wake event for this job.
 * Uses sudo (no dialog — sudoers entry was installed on first enable).
 */
export async function scheduleWake(jobId: string, nextFireAt: Date): Promise<void> {
  const wakeAt = new Date(nextFireAt.getTime() - WAKE_LEAD_MS);

  // Don't schedule wakes in the past
  if (wakeAt <= new Date()) return;

  // Cancel existing wake for this job first
  await cancelWake(jobId);

  const datetime = formatPmsetDate(wakeAt);
  await runPmset(["schedule", "wakeorpoweron", datetime]);
  scheduledWakes.set(jobId, wakeAt);
  console.error(`[wake-scheduler] scheduled wake for job ${jobId} at ${datetime}`);
}

/**
 * Cancel a scheduled wake event for a specific job.
 */
export async function cancelWake(jobId: string): Promise<void> {
  const existing = scheduledWakes.get(jobId);
  if (!existing) return;

  const datetime = formatPmsetDate(existing);
  scheduledWakes.delete(jobId);

  try {
    await runPmset(["schedule", "cancel", "wakeorpoweron", datetime]);
    console.error(`[wake-scheduler] cancelled wake for job ${jobId}`);
  } catch (err) {
    // Event may have already fired or been consumed — not fatal
    console.error(`[wake-scheduler] cancel wake for job ${jobId} (non-fatal):`, err);
  }
}

/**
 * Cancel all scheduled wake events (called on agent shutdown).
 * Purges both the in-memory map AND all pmset entries to handle
 * stale events from prior agent sessions.
 */
export async function cancelAllWakes(): Promise<void> {
  scheduledWakes.clear();

  try {
    await purgeAllPmsetWakes();
  } catch (err) {
    console.error("[wake-scheduler] cancel all: purge failed (non-fatal):", err);
  }
}

/**
 * Sync wake events with all enabled jobs that have a future nextFireAt.
 * Called on agent startup and when the feature is first enabled.
 *
 * First purges ALL existing pmset wakeorpoweron entries to prevent
 * accumulation from prior agent sessions, then schedules fresh events.
 */
export async function syncWakeEvents(): Promise<void> {
  // Purge stale events from prior sessions before adding new ones
  try {
    await purgeAllPmsetWakes();
  } catch (err) {
    console.error("[wake-scheduler] purge before sync failed (non-fatal):", err);
  }
  scheduledWakes.clear();

  const enabledJobs = listJobs({ isEnabled: true });
  const now = new Date();
  let scheduled = 0;

  for (const job of enabledJobs) {
    if (!job.nextFireAt) continue;
    const nextFire = new Date(job.nextFireAt);
    if (nextFire <= now) continue;
    const wakeAt = new Date(nextFire.getTime() - WAKE_LEAD_MS);
    if (wakeAt <= now) continue;

    try {
      await runPmset(["schedule", "wakeorpoweron", formatPmsetDate(wakeAt)]);
      scheduledWakes.set(job.id, wakeAt);
      scheduled++;
    } catch (err) {
      console.error(`[wake-scheduler] sync: failed to schedule for job ${job.id}:`, err);
    }
  }

  console.error(`[wake-scheduler] synced ${scheduled} wake event(s)`);
}

/**
 * Install the sudoers entry that grants the current user passwordless `sudo pmset`.
 * Shows ONE macOS admin dialog via osascript. Called when user enables the feature.
 */
export async function installSudoersEntry(): Promise<{
  authorized: boolean;
  error?: string;
}> {
  // Use `id -un` (not env vars) — env vars can be spoofed; id -un queries the kernel.
  let user: string;
  try {
    const { stdout } = await execFileAsync("/usr/bin/id", ["-un"], { timeout: 5000 });
    user = stdout.trim();
  } catch (err) {
    return { authorized: false, error: "Cannot determine current user via id -un" };
  }

  if (!user) {
    return { authorized: false, error: "id -un returned empty username" };
  }

  // Guard against shell injection — username is interpolated into an osascript
  // admin command. Reject anything that isn't a plain alphanumeric macOS username.
  if (!SAFE_USERNAME_RE.test(user)) {
    return { authorized: false, error: `Username contains unsafe characters: ${user}` };
  }

  // Use printf to avoid echo interpretation of escape sequences or special chars.
  // SAFE_USERNAME_RE guarantees no single-quotes or shell metacharacters in `user`.
  const entry = `${user} ALL=(root) NOPASSWD: /usr/bin/pmset`;

  try {
    // Single osascript call: write the file, set ownership & permissions.
    // printf is preferred over echo to avoid escape sequence interpretation.
    await execFileAsync("osascript", [
      "-e",
      `do shell script "printf '%s\\n' '${entry}' > ${SUDOERS_FILE} && chmod 0440 ${SUDOERS_FILE} && chown root:wheel ${SUDOERS_FILE}" with administrator privileges`,
    ]);
    console.error("[wake-scheduler] sudoers entry installed for passwordless pmset");
    return { authorized: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { authorized: false, error: message };
  }
}

/**
 * Remove the sudoers entry. Shows one admin dialog via osascript.
 * Called when user disables the feature (non-fatal if it fails).
 */
export async function removeSudoersEntry(): Promise<void> {
  try {
    await execFileAsync("osascript", [
      "-e",
      `do shell script "rm -f ${SUDOERS_FILE}" with administrator privileges`,
    ]);
    console.error("[wake-scheduler] sudoers entry removed");
  } catch (err) {
    // Non-fatal — entry may not exist or user may cancel
    console.error("[wake-scheduler] remove sudoers entry (non-fatal):", err);
  }
}

/**
 * Check whether the sudoers entry exists (i.e. passwordless pmset is available).
 * Does NOT show any dialog — just checks if the file exists.
 */
export async function checkWakeAuthorization(): Promise<{
  authorized: boolean;
  error?: string;
}> {
  if (!existsSync(SUDOERS_FILE)) {
    return { authorized: false, error: "Sudoers entry not installed" };
  }
  // Verify sudo actually works without password
  try {
    await execFileAsync("sudo", ["-n", "/usr/bin/pmset", "-g", "sched"], {
      timeout: 5000,
    });
    return { authorized: true };
  } catch {
    return { authorized: false, error: "Sudoers entry exists but sudo pmset still requires a password" };
  }
}

/** Number of currently tracked wake events. */
export function getScheduledWakeCount(): number {
  return scheduledWakes.size;
}

// ── Purge ────────────────────────────────────────────────────────────────────

/**
 * Parse `pmset -g sched` output and cancel every `wakeorpoweron` entry
 * that was created by `pmset` (our entries). This ensures stale events
 * from prior agent sessions don't accumulate in the system scheduler.
 *
 * Each matching line looks like:
 *   [3]  wakeorpoweron at 03/27/2026 11:15:20 by 'pmset'
 */
export async function purgeAllPmsetWakes(): Promise<number> {
  const { stdout } = await execFileAsync(
    "sudo",
    ["-n", "/usr/bin/pmset", "-g", "sched"],
    { timeout: 10_000 },
  );

  // Match lines like: wakeorpoweron at MM/DD/YYYY HH:MM:SS by 'pmset'
  const lineRe = /wakeorpoweron\s+at\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s+by\s+'pmset'/g;
  const datetimes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(stdout)) !== null) {
    datetimes.push(match[1]);
  }

  if (datetimes.length === 0) return 0;

  let cancelled = 0;
  for (const datetime of datetimes) {
    try {
      await runPmset(["schedule", "cancel", "wakeorpoweron", datetime]);
      cancelled++;
    } catch {
      // Event may have already fired — not fatal
    }
  }

  console.error(
    `[wake-scheduler] purged ${cancelled}/${datetimes.length} stale pmset wake event(s)`,
  );
  return cancelled;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a pmset command using sudo. No dialog is shown because the sudoers
 * entry installed on first enable grants passwordless access to pmset.
 */
async function runPmset(args: string[]): Promise<void> {
  const result = await execFileAsync("sudo", ["-n", "/usr/bin/pmset", ...args], {
    timeout: 10_000,
  });

  if (result.stderr?.trim()) {
    // pmset may write warnings to stderr — only throw on actual errors
    const stderr = result.stderr.trim();
    if (stderr.includes("Error") || stderr.includes("error")) {
      throw new Error(`pmset error: ${stderr}`);
    }
  }
}

/**
 * Format a Date as the string pmset expects: MM/dd/yyyy HH:mm:ss (24-hour, US order).
 */
export function formatPmsetDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${HH}:${MM}:${ss}`;
}
