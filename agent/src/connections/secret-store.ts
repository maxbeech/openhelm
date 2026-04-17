/**
 * Secret store abstraction — persists per-connection secrets.
 *
 * Backends:
 *   - `keychain` (local mode): macOS Keychain, `secret_ref = keychain:<connectionId>`
 *   - `supabase_vault` (cloud mode): Supabase Vault, `secret_ref = supabase_vault:<uuid>`.
 *     Driven by a callback the worker registers at boot, so the agent stays
 *     Supabase-client-free.
 */

import { getKeychainItem, setKeychainItem, deleteKeychainItem } from "../keychain/index.js";

export interface OAuthSecret {
  kind: "oauth";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface StaticSecret {
  kind: "static";
  /** For `token` type connections */
  token?: string;
  /** For `plain_text` type connections */
  username?: string;
  password?: string;
}

export interface CliAuthTarSecret {
  kind: "cli_auth_tar";
  /** Opaque storage key — local path or Supabase Storage key */
  storageKey: string;
}

export type ConnectionSecret = OAuthSecret | StaticSecret | CliAuthTarSecret;

/** Pluggable backend for secret persistence. */
export interface SecretStoreBackend {
  store(connectionId: string, secret: ConnectionSecret): Promise<void>;
  load(connectionId: string): Promise<ConnectionSecret | null>;
  remove(connectionId: string): Promise<void>;
}

/** Local backend — macOS Keychain. Default. */
const keychainBackend: SecretStoreBackend = {
  async store(connectionId, secret) {
    await setKeychainItem(`conn-${connectionId}`, JSON.stringify(secret));
  },
  async load(connectionId) {
    const raw = await getKeychainItem(`conn-${connectionId}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as ConnectionSecret; } catch { return null; }
  },
  async remove(connectionId) {
    try { await deleteKeychainItem(`conn-${connectionId}`); } catch { /* not found */ }
  },
};

let activeBackend: SecretStoreBackend = keychainBackend;

/**
 * Register a cloud backend (Supabase Vault). The worker calls this at boot
 * with a backend that routes to a Supabase Edge Function or direct SQL RPC.
 * Agents running locally never call this and keep using keychain.
 */
export function registerSecretStoreBackend(backend: SecretStoreBackend): void {
  activeBackend = backend;
}

/** Store or replace a secret for a connection. */
export async function storeConnectionSecret(
  connectionId: string,
  secret: ConnectionSecret,
): Promise<void> {
  await activeBackend.store(connectionId, secret);
}

/** Load a secret for a connection. Returns null if not found. */
export async function loadConnectionSecret(
  connectionId: string,
): Promise<ConnectionSecret | null> {
  return activeBackend.load(connectionId);
}

/** Delete a secret for a connection (e.g. on revocation or deletion). */
export async function deleteConnectionSecret(connectionId: string): Promise<void> {
  await activeBackend.remove(connectionId);
}

/**
 * Extract plaintext secret strings from a stored secret for the redactor.
 * Ensures values never appear in run logs.
 */
export function extractSecretStringsFromConnectionSecret(
  secret: ConnectionSecret,
): string[] {
  const secrets: string[] = [];
  if (secret.kind === "oauth") {
    if (secret.accessToken) secrets.push(secret.accessToken);
    if (secret.refreshToken) secrets.push(secret.refreshToken);
  } else if (secret.kind === "static") {
    if (secret.token) secrets.push(secret.token);
    if (secret.password) secrets.push(secret.password);
  }
  return secrets.filter(Boolean);
}
