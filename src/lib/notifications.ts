import type { InboxItem } from "@openorchestra/shared";

export async function notifyInboxItem(item: InboxItem): Promise<void> {
  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    const title =
      item.type === "permanent_failure"
        ? "Run Failed Permanently"
        : "Input Required";
    sendNotification({ title, body: item.title });
  } catch {
    // Tauri-only API — silently ignore in browser dev mode
  }
}
