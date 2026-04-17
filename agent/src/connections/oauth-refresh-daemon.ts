/**
 * Background daemon that refreshes OAuth tokens before they expire.
 *
 * Ticks once per hour. For every connection with `authStatus=authenticated`
 * and an `oauthTokenExpiresAt` within the next two hours, we attempt a
 * refresh via the provider's token endpoint. On success the secret store
 * and DB row are updated. On failure the connection is marked `expired`
 * so the UI can prompt for re-auth.
 *
 * The daemon is a no-op until tokens are actually stored — it's safe to
 * start unconditionally at agent boot.
 */

import * as connQueries from "../db/queries/connections.js";
import { refreshOAuthToken } from "./oauth-flow.js";
import { loadConnectionSecret } from "./secret-store.js";

const TICK_MS = 60 * 60 * 1000;          // 1 hour
const REFRESH_WINDOW_MS = 2 * 60 * 60 * 1000; // refresh if expiring in <2h

/**
 * Connection-level OAuth config. Stored in `connection.config` so we know
 * which token endpoint + client ID to hit without asking the user again.
 */
interface OAuthConnectionConfig {
  tokenEndpoint?: string;
  clientId?: string;
}

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export function startOAuthRefreshDaemon(): void {
  if (timer) return;
  console.error("[oauth-daemon] started (tick every 1h)");
  // Do not block agent boot: fire an initial tick on a short delay.
  timer = setTimeout(function loop() {
    void tick().finally(() => {
      timer = setTimeout(loop, TICK_MS);
    });
  }, 30_000);
}

export function stopOAuthRefreshDaemon(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const all = connQueries.listConnections();
    const now = Date.now();
    for (const conn of all) {
      if (conn.authStatus !== "authenticated") continue;
      if (!conn.oauthTokenExpiresAt) continue;
      const expiresAt = new Date(conn.oauthTokenExpiresAt).getTime();
      if (isNaN(expiresAt)) continue;
      if (expiresAt - now > REFRESH_WINDOW_MS) continue;

      const cfg = conn.config as OAuthConnectionConfig;
      if (!cfg.tokenEndpoint || !cfg.clientId) {
        // Can't refresh without endpoint + client; skip silently.
        continue;
      }
      const secret = await loadConnectionSecret(conn.id);
      if (!secret || secret.kind !== "oauth" || !secret.refreshToken) continue;

      try {
        await refreshOAuthToken({
          connectionId: conn.id,
          tokenEndpoint: cfg.tokenEndpoint,
          clientId: cfg.clientId,
        });
        console.error(`[oauth-daemon] refreshed connection ${conn.id} (${conn.name})`);
      } catch (err) {
        // refreshOAuthToken already marks the row expired on failure.
        console.error(`[oauth-daemon] refresh failed for ${conn.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[oauth-daemon] tick error (non-fatal):", err);
  } finally {
    ticking = false;
  }
}
