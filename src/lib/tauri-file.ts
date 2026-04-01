/**
 * Native file upload helpers for data table file cells.
 *
 * Flow:
 *  1. pickAndCopyFile() → opens macOS file picker via plugin-dialog
 *  2. The chosen path is passed to the Rust `copy_file_to_storage` command
 *  3. Rust copies the file into <data_dir>/files/ and returns metadata
 *  4. A FileReference with the local path is returned to the caller
 *
 * For opening local files, openFileExternally() uses plugin-shell so the OS
 * launches the file with its default application.
 */

import { invoke } from "@tauri-apps/api/core";
import type { FileReference } from "@openhelm/shared";

interface StoredFileInfo {
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

/**
 * Open the native macOS file picker, copy the chosen file into OpenHelm's
 * local storage, and return a FileReference. Returns null if the user cancels.
 */
export async function pickAndCopyFile(): Promise<FileReference | null> {
  // Dynamic import keeps plugin-dialog out of the test/browser bundle.
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, directory: false });
  if (!selected) return null;

  // In Tauri 2 `open({ multiple: false })` returns `string | null`.
  const sourcePath = typeof selected === "string" ? selected : (selected as { path: string }).path;

  const info = await invoke<StoredFileInfo>("copy_file_to_storage", { path: sourcePath });

  return {
    id: `f_${crypto.randomUUID().slice(0, 8)}`,
    name: info.name,
    url: info.path,
    size: info.size,
    mimeType: info.mimeType,
  };
}

/** True when url is a local absolute path rather than an http(s) URL. */
export function isLocalFile(url: string): boolean {
  return url.startsWith("/") || url.startsWith("file://");
}

/**
 * Open a file or URL using the appropriate mechanism:
 * - Local paths → macOS `open` command via plugin-shell (launches default app)
 * - Remote URLs  → new browser tab
 */
export async function openFileExternally(url: string): Promise<void> {
  if (isLocalFile(url)) {
    // shell:allow-open scopes block file:// — use a dedicated Rust command that
    // calls macOS `open <path>` directly.
    const path = url.startsWith("file://") ? url.slice(7) : url;
    await invoke("open_local_file", { path });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
