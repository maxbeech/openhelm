import { execFile } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as credQueries from "../../db/queries/credentials.js";
import { setKeychainItem, getKeychainItem, deleteKeychainItem } from "../../keychain/index.js";
import { buildInstructionPageUrl } from "../../credentials/browser-setup-page.js";
import { BrowserSessionMonitor } from "../../credentials/browser-session-monitor.js";
import type {
  CreateCredentialParams,
  UpdateCredentialParams,
  ListCredentialsParams,
  ListCredentialsByScopeParams,
  CredentialValue,
  CredentialWithValue,
  SetupBrowserProfileParams,
  SetupBrowserProfileResult,
} from "@openhelm/shared";

/** Active browser session monitors, keyed by credentialId. */
const activeMonitors = new Map<string, BrowserSessionMonitor>();

export function registerCredentialHandlers() {
  registerHandler("credentials.list", (params) => {
    const p = params as ListCredentialsParams | undefined;
    return credQueries.listCredentials(p);
  });

  registerHandler("credentials.listAll", () => {
    return credQueries.listCredentials();
  });

  registerHandler("credentials.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const cred = credQueries.getCredential(id);
    if (!cred) throw new Error(`Credential not found: ${id}`);
    return cred;
  });

  registerHandler("credentials.getValue", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const cred = credQueries.getCredential(id);
    if (!cred) throw new Error(`Credential not found: ${id}`);

    let value: CredentialValue | null = null;
    try {
      const raw = await getKeychainItem(id);
      if (raw) value = JSON.parse(raw) as CredentialValue;
    } catch (err) {
      console.error("[credentials] keychain read error:", err);
      throw new Error(
        err instanceof Error ? err.message : "Failed to read credential from Keychain",
      );
    }

    const result: CredentialWithValue = { ...cred, value };
    return result;
  });

  registerHandler("credentials.create", async (params) => {
    const p = params as CreateCredentialParams;
    if (!p?.name) throw new Error("name is required");
    if (!p?.type) throw new Error("type is required");
    if (!p?.value) throw new Error("value is required");

    // Store metadata in SQLite (env var name is auto-generated inside createCredential)
    const cred = credQueries.createCredential(p);

    // Store secret value in Keychain
    try {
      await setKeychainItem(cred.id, JSON.stringify(p.value));
    } catch (err) {
      // Rollback metadata if Keychain write fails
      credQueries.deleteCredential(cred.id);
      throw new Error(
        err instanceof Error ? err.message : "Failed to store credential in Keychain",
      );
    }

    emit("credential.created", cred);
    return cred;
  });

  registerHandler("credentials.update", async (params) => {
    const p = params as UpdateCredentialParams;
    if (!p?.id) throw new Error("id is required");

    // Update metadata in SQLite
    const cred = credQueries.updateCredential(p);

    // Update secret value in Keychain if provided
    if (p.value) {
      try {
        await setKeychainItem(cred.id, JSON.stringify(p.value));
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to update credential in Keychain",
        );
      }
    }

    emit("credential.updated", cred);
    return cred;
  });

  registerHandler("credentials.delete", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");

    const deleted = credQueries.deleteCredential(id);
    if (deleted) {
      // Best-effort Keychain delete (don't fail if not found)
      try {
        await deleteKeychainItem(id);
      } catch (err) {
        console.error("[credentials] keychain delete error (non-fatal):", err);
      }
      emit("credential.deleted", { id });
    }
    return { deleted };
  });

  registerHandler("credentials.listForScope", (params) => {
    const p = params as ListCredentialsByScopeParams;
    if (!p?.scopeType || !p?.scopeId) throw new Error("scopeType and scopeId are required");
    return credQueries.listCredentialsByScope(p);
  });

  /**
   * Atomically replace the set of credentials bound to an entity (project/goal/job).
   * Params: { scopeType, scopeId, credentialIds: string[] }
   * For each credentialId in the new set, ensures the binding exists.
   * For any credential previously bound to this scope but not in credentialIds, removes that binding.
   */
  registerHandler("credentials.setScopesForEntity", (params) => {
    const { scopeType, scopeId, credentialIds } = params as {
      scopeType: "project" | "goal" | "job";
      scopeId: string;
      credentialIds: string[];
    };
    if (!scopeType || !scopeId) throw new Error("scopeType and scopeId are required");
    if (!Array.isArray(credentialIds)) throw new Error("credentialIds must be an array");
    return credQueries.setScopeBindingsForEntity({ scopeType, scopeId, credentialIds });
  });

  registerHandler("credentials.count", (params) => {
    const { projectId } = params as { projectId?: string };
    return { count: credQueries.countCredentials(projectId ?? undefined) };
  });

  registerHandler("credentials.countAll", () => {
    return { count: credQueries.countCredentials() };
  });

  /**
   * Launch Chrome with a persistent profile for one-time manual login.
   *
   * Creates a named profile under ~/.openhelm/profiles/ and opens Chrome
   * with that user-data-dir so the user can log in once. Sessions persist
   * for future automation runs.
   */
  registerHandler("credential.setupBrowserProfile", async (params) => {
    const { credentialId, loginUrl } = params as SetupBrowserProfileParams;
    if (!credentialId) throw new Error("credentialId is required");

    // Stop any existing monitor for this credential
    const existing = activeMonitors.get(credentialId);
    if (existing) existing.stop();
    activeMonitors.delete(credentialId);

    const cred = credQueries.getCredential(credentialId);
    if (!cred) throw new Error(`Credential not found: ${credentialId}`);

    const profileName = `cred-${credentialId}`;
    const profilesRoot = join(
      process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
      "profiles",
    );
    const profileDir = join(profilesRoot, profileName);
    const metaPath = join(profilesRoot, "profiles.json");

    // Ensure profile directory and metadata exist
    mkdirSync(profileDir, { recursive: true });

    // Pre-create "First Run" sentinel to suppress Chrome's first-run wizard
    const firstRunPath = join(profileDir, "First Run");
    if (!existsSync(firstRunPath)) writeFileSync(firstRunPath, "");

    let meta: Record<string, unknown> = {};
    try {
      if (existsSync(metaPath)) {
        meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      }
    } catch { /* fresh metadata */ }

    if (!meta[profileName]) {
      meta[profileName] = {
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        notes: `Browser profile for credential "${cred.name}"`,
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    if (cred.browserProfileName !== profileName) {
      credQueries.updateCredential({ id: credentialId, browserProfileName: profileName });
    }

    // Build instruction page instead of about:blank
    const url = buildInstructionPageUrl(loginUrl);

    const chromeArgs = [
      `--user-data-dir=${profileDir}`,
      // Stealth
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      // Suppress first-run / welcome dialogs
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--disable-session-crashed-bubble",
      "--disable-features=ChromeWhatsNewUI",
      // Use in-profile password store (not macOS Keychain)
      "--password-store=basic",
      url,
    ];

    return new Promise<SetupBrowserProfileResult>((resolve) => {
      execFile(
        "open",
        ["-n", "-a", "Google Chrome", "--args", ...chromeArgs],
        { timeout: 10_000 },
        (err) => {
          if (err) {
            resolve({
              profileName,
              launched: false,
              message: `Failed to launch Chrome: ${err.message}`,
            });
            return;
          }

          // Start SingletonLock-based monitor (watches Chrome's profile lock file)
          const monitor = new BrowserSessionMonitor(credentialId, profileDir);
          activeMonitors.set(credentialId, monitor);
          monitor.start();
          emit("credential.browserLaunched", { credentialId });

          resolve({
            profileName,
            launched: true,
            message: "Chrome opened. Log in to your site, then quit Chrome (⌘Q) when done.",
          });
        },
      );
    });
  });

  /** Stop monitoring a browser setup (e.g. when user dismisses the dialog). */
  registerHandler("credential.cancelBrowserSetup", (params) => {
    const { credentialId } = params as { credentialId: string };
    if (!credentialId) throw new Error("credentialId is required");
    const monitor = activeMonitors.get(credentialId);
    if (monitor) {
      monitor.stop();
      activeMonitors.delete(credentialId);
    }
    return { cancelled: true };
  });
}
