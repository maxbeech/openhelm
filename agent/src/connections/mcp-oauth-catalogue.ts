/**
 * Hard-coded OAuth 2.0 configs for first-party MCP servers.
 *
 * Only servers that OpenHelm has registered as an OAuth app with the
 * provider appear here. All others fall back to token-paste auth in the UI.
 *
 * To add a provider:
 *   1. Register OpenHelm as an OAuth app with the provider.
 *   2. Add an entry keyed by the mcpServerId namespace prefix.
 *   3. Add `openhelm://oauth/callback` to the provider's allowed redirect URIs.
 */

export interface McpOAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
  redirectUri: string;
}

// Keyed by mcpServerId prefix — "com.github" matches "com.github/mcp", etc.
const OAUTH_CONFIGS: Record<string, McpOAuthConfig> = {
  // Add entries once OAuth apps are registered with each provider:
  // "com.github": {
  //   authorizationEndpoint: "https://github.com/login/oauth/authorize",
  //   tokenEndpoint: "https://github.com/login/oauth/access_token",
  //   clientId: "Ov23liXXXXXXXXXX",
  //   scope: "repo read:user",
  //   redirectUri: "openhelm://oauth/callback",
  // },
  // "io.github.makenotion": {
  //   authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
  //   tokenEndpoint: "https://api.notion.com/v1/oauth/token",
  //   clientId: "NOTION_CLIENT_ID",
  //   scope: "",
  //   redirectUri: "openhelm://oauth/callback",
  // },
};

/**
 * Look up the OAuth config for an MCP server ID.
 * Returns null if no registered config exists — UI shows token-paste fallback.
 */
export function getMcpOAuthConfig(mcpServerId: string): McpOAuthConfig | null {
  for (const [prefix, config] of Object.entries(OAUTH_CONFIGS)) {
    if (mcpServerId.startsWith(prefix) && config.clientId) return config;
  }
  return null;
}
