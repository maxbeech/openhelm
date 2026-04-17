/**
 * Supabase Vault backend for the connection secret store.
 *
 * Implements SecretStoreBackend from agent/src/connections/secret-store.ts.
 * Uses SECURITY DEFINER RPCs (defined in the connections overhaul migration)
 * so per-user ownership is enforced server-side, not just in TypeScript.
 *
 * Registered at worker boot so the agent-side secret-store abstraction routes
 * all cloud secret operations here instead of the local macOS Keychain.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConnectionSecret {
  kind: "oauth" | "static" | "cli_auth_tar";
  [key: string]: unknown;
}

export interface SecretStoreBackend {
  store(connectionId: string, secret: ConnectionSecret): Promise<void>;
  load(connectionId: string): Promise<ConnectionSecret | null>;
  remove(connectionId: string): Promise<void>;
}

let _activeBackend: SecretStoreBackend | null = null;

/** Initialize the module-level vault backend. Called once at worker boot. */
export function initVaultBackend(supabase: SupabaseClient): void {
  _activeBackend = createSupabaseVaultBackend(supabase);
}

/** Get the active vault backend. Throws if not yet initialized. */
export function getVaultBackend(): SecretStoreBackend {
  if (!_activeBackend) throw new Error("[vault] backend not initialized — call initVaultBackend() first");
  return _activeBackend;
}

export function createSupabaseVaultBackend(supabase: SupabaseClient): SecretStoreBackend {
  return {
    async store(connectionId, secret) {
      const plaintext = JSON.stringify(secret);
      const { error } = await supabase.rpc("vault_create_connection_secret", {
        p_connection_id: connectionId,
        p_secret: plaintext,
      });
      if (error) throw new Error(`vault store failed for ${connectionId}: ${error.message}`);
    },

    async load(connectionId) {
      const { data, error } = await supabase.rpc("vault_read_connection_secret", {
        p_connection_id: connectionId,
      });
      if (error) throw new Error(`vault load failed for ${connectionId}: ${error.message}`);
      if (!data) return null;
      try {
        return JSON.parse(data as string) as ConnectionSecret;
      } catch {
        return null;
      }
    },

    async remove(connectionId) {
      const { error } = await supabase.rpc("vault_delete_connection_secret", {
        p_connection_id: connectionId,
      });
      // Non-fatal if the secret doesn't exist (delete is idempotent)
      if (error && !error.message.includes("not found")) {
        console.error(`[vault] remove failed for ${connectionId} (non-fatal):`, error.message);
      }
    },
  };
}
