/**
 * Interactive browser-profile setup for cloud-mode credentials.
 *
 * setupBrowserSession    → spawn an E2B Desktop sandbox, launch Chromium,
 *                          start the noVNC stream, return the embed URL.
 * finalizeBrowserSession → tar the profile out, upload to Supabase Storage,
 *                          stamp the credentials row, kill the sandbox.
 * cancelBrowserSession   → kill a running setup sandbox without saving.
 *
 * Session state (active sandboxes, timeouts, ownership) lives in
 * credential-setup-session.ts to keep each file under the 225-line limit.
 */

import { Sandbox } from "@e2b/desktop";
import { getSupabase } from "./supabase.js";
import { config } from "./config.js";
import {
  SETUP_TIMEOUT_MS,
  PROFILE_BUCKET,
  type ActiveSession,
  profileDirFor,
  profileStorageKey,
  registerSession,
  findByCredential,
  requireSession,
  lookupSession,
  killSession,
} from "./credential-setup-session.js";

async function assertCredentialOwned(
  credentialId: string,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("credentials")
    .select("id")
    .eq("id", credentialId)
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    throw new Error("Credential not found or not owned by caller");
  }
}

export interface SetupBrowserSessionResult {
  sandboxId: string;
  streamUrl: string;
  profileName: string;
  launched: true;
  expiresAt: number;
  message: string;
}

export async function setupBrowserSession(
  params: { credentialId: string; loginUrl?: string },
  userId: string,
): Promise<SetupBrowserSessionResult> {
  const { credentialId, loginUrl } = params;
  if (!credentialId) throw new Error("credentialId is required");

  await assertCredentialOwned(credentialId, userId);

  // Kill any prior session for this credential before spawning a new one.
  const prior = findByCredential(credentialId, userId);
  if (prior) await killSession(prior.sandboxId).catch(() => {});

  const sandbox = await Sandbox.create(config.e2bTemplateId, {
    apiKey: config.e2bApiKey,
    timeoutMs: SETUP_TIMEOUT_MS,
  });

  const profileDir = profileDirFor(credentialId);
  await sandbox.commands.run(`mkdir -p ${profileDir}`);
  await sandbox.commands.run(`touch "${profileDir}/First Run"`);

  // Launch Chromium in the background pointing at the credential's profile.
  const url = loginUrl ?? "about:blank";
  const chromeFlags = [
    `--user-data-dir=${profileDir}`,
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    `"${url}"`,
  ].join(" ");
  // Ubuntu 22.04's chromium-browser apt package is a snap shim that fails in
  // containers, so the template installs google-chrome-stable instead.
  // DISPLAY=:0 was set on the sandbox by the desktop SDK when Xvfb started.
  await sandbox.commands.run(
    `DISPLAY=:0 nohup google-chrome-stable ${chromeFlags} > /tmp/chromium.log 2>&1 &`,
    { background: true },
  );

  // Start the desktop stream and fetch the signed embed URL.
  await sandbox.stream.start();
  const streamUrl = sandbox.stream.getUrl();

  const sandboxId = sandbox.sandboxId;
  const expiresAt = Date.now() + SETUP_TIMEOUT_MS;

  const timeoutHandle = setTimeout(() => {
    killSession(sandboxId).catch((err) =>
      console.error(`[credential-setup] timeout kill failed:`, err),
    );
  }, SETUP_TIMEOUT_MS);
  // Don't hold the event loop open just for this timer — the process can
  // exit cleanly on shutdown even if setup sessions are still in flight.
  timeoutHandle.unref();

  const session: ActiveSession = {
    sandboxId,
    credentialId,
    userId,
    profileDir,
    expiresAt,
    timeoutHandle,
  };
  registerSession(session);

  // Persist the profile name on the credentials row so run-time hydration
  // knows which tarball to look for later.
  await getSupabase()
    .from("credentials")
    .update({ browser_profile_name: `cred-${credentialId}` })
    .eq("id", credentialId)
    .eq("user_id", userId);

  return {
    sandboxId,
    streamUrl,
    profileName: `cred-${credentialId}`,
    launched: true,
    expiresAt,
    message: "Desktop sandbox ready. Log in, then click Done.",
  };
}

export interface FinalizeBrowserSessionResult {
  credentialId: string;
  status: "likely_logged_in" | "no_cookies_detected";
  storageKey: string;
  verifiedAt: string;
}

export async function finalizeBrowserSession(
  params: { sandboxId: string },
  userId: string,
): Promise<FinalizeBrowserSessionResult> {
  const session = requireSession(params.sandboxId, userId);

  const sandbox = await Sandbox.connect(session.sandboxId, {
    apiKey: config.e2bApiKey,
  });

  // Gracefully close Chrome so the Cookies SQLite file flushes.
  await sandbox.commands.run("pkill -TERM -f 'chrome|chromium' || true");
  await new Promise((r) => setTimeout(r, 1_500));

  // Classify on the actual Cookies file size inside the profile — mirrors
  // agent/src/credentials/browser-session-monitor.ts (>2 KB means at least
  // one real cookie was written by Chromium).
  const cookiePath = `${session.profileDir}/Default/Cookies`;
  const cookieSize = await sandbox.commands
    .run(`stat -c '%s' ${cookiePath} 2>/dev/null || echo 0`)
    .then((res: { stdout: string }) => parseInt(res.stdout.trim() || "0", 10))
    .catch(() => 0);
  const status: FinalizeBrowserSessionResult["status"] =
    cookieSize > 2048 ? "likely_logged_in" : "no_cookies_detected";

  await sandbox.commands.run(
    `tar -czf /tmp/profile.tar.gz -C /home/user/profiles cred-${session.credentialId}`,
  );

  const tarball = await sandbox.files.read("/tmp/profile.tar.gz", {
    format: "bytes",
  });
  const tarballBytes = tarball instanceof Uint8Array
    ? tarball
    : new Uint8Array(tarball as ArrayBufferLike);

  const storageKey = profileStorageKey(userId, session.credentialId);
  const supabase = getSupabase();
  const { error: uploadErr } = await supabase.storage
    .from(PROFILE_BUCKET)
    .upload(storageKey, tarballBytes, {
      contentType: "application/gzip",
      upsert: true,
    });
  if (uploadErr) throw new Error(`profile upload failed: ${uploadErr.message}`);

  const verifiedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("credentials")
    .update({
      browser_profile_storage_key: storageKey,
      browser_profile_verified_at: verifiedAt,
    })
    .eq("id", session.credentialId)
    .eq("user_id", userId);
  if (updateErr) throw new Error(`credentials update failed: ${updateErr.message}`);

  await killSession(session.sandboxId);

  return {
    credentialId: session.credentialId,
    status,
    storageKey,
    verifiedAt,
  };
}

export async function cancelBrowserSession(
  params: { sandboxId: string },
  userId: string,
): Promise<{ cancelled: true }> {
  // If the session is tracked, enforce ownership. If it isn't, killSession
  // is still a safe no-op (best-effort) — e.g. after a timeout cleanup.
  const existing = lookupSession(params.sandboxId);
  if (existing && existing.userId !== userId) {
    throw new Error("Session not owned by caller");
  }
  await killSession(params.sandboxId);
  return { cancelled: true };
}
