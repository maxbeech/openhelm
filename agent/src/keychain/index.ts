/**
 * macOS Keychain wrapper — stores and retrieves credential secrets
 * using the system `security` CLI tool.
 *
 * Service name matches the Tauri app identifier so items are grouped
 * under the OpenHelm app in Keychain Access.
 */

import { execFile } from "child_process";

const SECURITY_BIN = "/usr/bin/security";
const SERVICE_NAME = "com.maxbeech.openhelm";

/** Exit codes from the `security` command */
const ERR_NOT_FOUND = 44;
const ERR_USER_INTERACTION_NOT_ALLOWED = 36;

function run(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(SECURITY_BIN, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err && "code" in err && typeof err.code === "number") {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: err.code });
        return;
      }
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: 0 });
    });

    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** Store or update a credential value in Keychain */
export async function setKeychainItem(id: string, value: string): Promise<void> {
  // -U = update if exists, -s = service, -a = account, -w = password
  const result = await run([
    "add-generic-password",
    "-U",
    "-s", SERVICE_NAME,
    "-a", id,
    "-w", value,
  ]);

  if (result.code !== 0) {
    if (result.code === ERR_USER_INTERACTION_NOT_ALLOWED) {
      throw new Error("macOS Keychain is locked. Unlock it by entering your macOS password.");
    }
    throw new Error(`Keychain write failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
}

/** Retrieve a credential value from Keychain. Returns null if not found. */
export async function getKeychainItem(id: string): Promise<string | null> {
  const result = await run([
    "find-generic-password",
    "-s", SERVICE_NAME,
    "-a", id,
    "-w",
  ]);

  if (result.code === ERR_NOT_FOUND) return null;
  if (result.code === ERR_USER_INTERACTION_NOT_ALLOWED) {
    throw new Error("macOS Keychain is locked. Unlock it by entering your macOS password.");
  }
  if (result.code !== 0) {
    throw new Error(`Keychain read failed (exit ${result.code}): ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}

/** Delete a credential from Keychain. Returns true if deleted, false if not found. */
export async function deleteKeychainItem(id: string): Promise<boolean> {
  const result = await run([
    "delete-generic-password",
    "-s", SERVICE_NAME,
    "-a", id,
  ]);

  if (result.code === ERR_NOT_FOUND) return false;
  if (result.code !== 0) {
    throw new Error(`Keychain delete failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
  return true;
}
