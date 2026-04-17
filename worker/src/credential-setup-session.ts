/**
 * Active browser-setup session bookkeeping.
 *
 * Tracks live E2B Desktop sandboxes spawned for credential setup so we can
 * enforce per-user ownership, apply a 30-minute hard timeout, and kill them
 * on user dismissal. Kept separate from credential-setup.ts to keep both
 * files under the 225-line project limit.
 */

import { Sandbox } from "@e2b/desktop";
import { config } from "./config.js";

export const SETUP_TIMEOUT_MS = 30 * 60 * 1000;
export const PROFILE_BUCKET = "browser-profiles";

export interface ActiveSession {
  sandboxId: string;
  credentialId: string;
  userId: string;
  profileDir: string;
  expiresAt: number;
  timeoutHandle: NodeJS.Timeout;
}

const activeSessions = new Map<string, ActiveSession>();

export function profileDirFor(credentialId: string): string {
  return `/home/user/profiles/conn-${credentialId}`;
}

export function profileStorageKey(userId: string, credentialId: string): string {
  return `${userId}/${credentialId}.tar.gz`;
}

export function registerSession(session: ActiveSession): void {
  activeSessions.set(session.sandboxId, session);
}

export function findByCredential(
  credentialId: string,
  userId: string,
): ActiveSession | undefined {
  for (const session of activeSessions.values()) {
    if (session.credentialId === credentialId && session.userId === userId) {
      return session;
    }
  }
  return undefined;
}

export function requireSession(sandboxId: string, userId: string): ActiveSession {
  const session = activeSessions.get(sandboxId);
  if (!session) throw new Error(`Unknown sandbox: ${sandboxId}`);
  if (session.userId !== userId) throw new Error("Session not owned by caller");
  return session;
}

export function lookupSession(sandboxId: string): ActiveSession | undefined {
  return activeSessions.get(sandboxId);
}

export async function killSession(sandboxId: string): Promise<void> {
  const session = activeSessions.get(sandboxId);
  if (session) {
    clearTimeout(session.timeoutHandle);
    activeSessions.delete(sandboxId);
  }
  try {
    const sandbox = await Sandbox.connect(sandboxId, {
      apiKey: config.e2bApiKey,
    });
    await sandbox.kill();
  } catch (err) {
    // Best-effort: sandbox may already be gone (timeout, crash, prior kill).
    console.error(`[credential-setup] kill sandbox ${sandboxId}:`, err);
  }
}
