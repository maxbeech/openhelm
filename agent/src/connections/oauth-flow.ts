/**
 * Generic PKCE OAuth 2.0 flow for MCP server and CLI authentication.
 *
 * Handles: code_challenge generation, state persistence, authorization URL
 * construction, code exchange, token storage via secret-store, and refresh.
 */

import { randomBytes, createHash } from "crypto";
import * as connQueries from "../db/queries/connections.js";

interface PkceState {
  connectionId: string;
  codeVerifier: string;
  state: string;
  createdAt: number;
}

// In-memory store for PKCE states keyed by `state` param.
// Short TTL — the user must complete the flow in the same agent process session.
const pendingFlows = new Map<string, PkceState>();
const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

/** Prune states older than FLOW_TTL_MS to prevent unbounded growth. */
function pruneExpiredFlows(): void {
  const cutoff = Date.now() - FLOW_TTL_MS;
  for (const [key, flow] of pendingFlows.entries()) {
    if (flow.createdAt < cutoff) pendingFlows.delete(key);
  }
}

export interface OAuthStartResult {
  authorizationUrl: string;
  state: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

/**
 * Start a PKCE OAuth flow for a connection.
 *
 * @param connectionId - the connection row ID
 * @param authorizationEndpoint - provider's authorization URL
 * @param clientId - registered OAuth client ID
 * @param redirectUri - must match the registered redirect URI
 * @param scope - space-separated OAuth scopes
 */
export function startOAuthFlow(params: {
  connectionId: string;
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}): OAuthStartResult {
  pruneExpiredFlows();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = generateState();

  pendingFlows.set(state, {
    connectionId: params.connectionId,
    codeVerifier,
    state,
    createdAt: Date.now(),
  });

  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { authorizationUrl: url.toString(), state };
}

/**
 * Complete a PKCE OAuth flow by exchanging the authorization code for tokens.
 *
 * On success, stores the token set via the secret-store and updates the
 * connection's `authStatus` to `authenticated`.
 */
export async function completeOAuthFlow(params: {
  state: string;
  code: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
}): Promise<OAuthTokenSet> {
  const flow = pendingFlows.get(params.state);
  if (!flow) {
    throw new Error(`OAuth state not found or expired: ${params.state}`);
  }

  pendingFlows.delete(params.state);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: flow.codeVerifier,
  });

  const resp = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as Record<string, unknown>;

  const tokenSet: OAuthTokenSet = {
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : undefined,
    scope: data.scope ? String(data.scope) : undefined,
  };

  if (!tokenSet.accessToken) {
    throw new Error("Token exchange response missing access_token");
  }

  // Persist token and update connection status
  const { storeConnectionSecret } = await import("./secret-store.js");
  await storeConnectionSecret(flow.connectionId, {
    kind: "oauth",
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scope: tokenSet.scope,
  });

  connQueries.updateConnection({
    id: flow.connectionId,
    authStatus: "authenticated",
    oauthTokenExpiresAt: tokenSet.expiresAt ? new Date(tokenSet.expiresAt).toISOString() : undefined,
  });

  return tokenSet;
}

/**
 * Refresh an OAuth access token using the stored refresh token.
 * Updates the connection row and secret store on success.
 */
export async function refreshOAuthToken(params: {
  connectionId: string;
  tokenEndpoint: string;
  clientId: string;
}): Promise<OAuthTokenSet> {
  const { loadConnectionSecret } = await import("./secret-store.js");
  const secret = await loadConnectionSecret(params.connectionId);

  if (!secret || secret.kind !== "oauth" || !secret.refreshToken) {
    throw new Error(`No refresh token available for connection ${params.connectionId}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
    client_id: params.clientId,
  });

  const resp = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    // Mark as expired so the UI shows a re-auth prompt
    connQueries.updateConnection({ id: params.connectionId, authStatus: "expired" });
    const text = await resp.text().catch(() => "");
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as Record<string, unknown>;

  const tokenSet: OAuthTokenSet = {
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token
      ? String(data.refresh_token)
      : secret.refreshToken, // keep old refresh token if not rotated
    expiresAt: data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : undefined,
    scope: data.scope ? String(data.scope) : secret.scope,
  };

  const { storeConnectionSecret } = await import("./secret-store.js");
  await storeConnectionSecret(params.connectionId, {
    kind: "oauth",
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scope: tokenSet.scope,
  });

  connQueries.updateConnection({
    id: params.connectionId,
    authStatus: "authenticated",
    oauthTokenExpiresAt: tokenSet.expiresAt ? new Date(tokenSet.expiresAt).toISOString() : undefined,
  });

  return tokenSet;
}
