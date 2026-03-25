import type { InboxItem, NotificationLevel, RunStatus } from "@openhelm/shared";
import * as api from "./api";

async function getNotificationLevel(): Promise<NotificationLevel> {
  try {
    const s = await api.getSetting("notification_level");
    if (
      s?.value === "never" ||
      s?.value === "on_finish" ||
      s?.value === "alerts_only"
    ) {
      return s.value;
    }
  } catch {
    // fall through to default
  }
  return "alerts_only";
}

/**
 * Send a native macOS notification via a custom Tauri command backed by osascript.
 *
 * The official `tauri-plugin-notification` desktop path uses `mac-notification-sys`
 * which relies on `NSUserNotificationCenter` — removed in macOS 14 (Sonoma). Our
 * custom `send_notification` command runs `osascript -e 'display notification...'`
 * which routes through the current UNUserNotificationCenter API and works on all
 * modern macOS versions.
 */
async function sendNativeNotification(title: string, body: string): Promise<void> {
  // Guard: Tauri invoke is only available inside the Tauri WebView, not in browser dev mode.
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  console.log("[notifications] invoke send_notification", { title, body });
  await invoke("send_notification", { title, body });
}

export async function notifyInboxItem(item: InboxItem): Promise<void> {
  const level = await getNotificationLevel();
  if (level === "never") return;
  // Both "on_finish" and "alerts_only" send inbox alert notifications
  try {
    const title =
      item.type === "permanent_failure"
        ? "Run Failed Permanently"
        : "Run Stalled";
    await sendNativeNotification(title, item.title);
  } catch (err) {
    console.error("[notifications] notifyInboxItem invoke failed:", err);
  }
}

export async function notifyRunCompleted(
  status: RunStatus,
  jobName: string,
  summary?: string | null,
): Promise<void> {
  const level = await getNotificationLevel();
  if (level !== "on_finish") return;
  try {
    const title =
      status === "succeeded"
        ? `"${jobName}" succeeded`
        : `"${jobName}" finished (${status})`;
    console.log("[notifications] sending invoke notify:", { title });
    await sendNativeNotification(title, summary ?? "");
    console.log("[notifications] invoke notify succeeded");
  } catch (err) {
    console.error("[notifications] notifyRunCompleted invoke failed:", err);
  }
}

/**
 * Request macOS notification permission via our custom Rust command.
 * Delegates to UNUserNotificationCenter.requestAuthorization inside the app process
 * so the system prompt is attributed to OpenHelm.
 */
export async function ensureNotificationPermission(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("request_notification_permission");
  } catch {
    // Tauri-only API — silently ignore in browser dev mode
  }
}
