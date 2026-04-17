import { execFile } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { registerHandler } from "../handler.js";
import { emit } from "../emitter.js";
import * as connQueries from "../../db/queries/connections.js";
import { setKeychainItem, getKeychainItem, deleteKeychainItem } from "../../keychain/index.js";
import { buildInstructionPageUrl } from "../../credentials/browser-setup-page.js";
import { BrowserSessionMonitor } from "../../credentials/browser-session-monitor.js";
import { searchMcpRegistry } from "../../connections/mcp-registry.js";
import { searchServices } from "../../connections/service-search.js";
import { getCliCatalogue } from "../../connections/cli-catalogue.js";
import type {
  CreateConnectionParams,
  UpdateConnectionParams,
  ListConnectionsParams,
  ListConnectionsByScopeParams,
  ConnectionValue,
  ConnectionWithValue,
  SetupBrowserProfileParams,
  SetupBrowserProfileResult,
} from "@openhelm/shared";

const activeMonitors = new Map<string, BrowserSessionMonitor>();

export function registerConnectionHandlers() {
  // ─── Core CRUD ─────────────────────────────────────────────────────────────

  registerHandler("connections.list", (params) => {
    return connQueries.listConnections(params as ListConnectionsParams | undefined);
  });

  registerHandler("connections.listAll", () => {
    return connQueries.listConnections();
  });

  registerHandler("connections.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const conn = connQueries.getConnection(id);
    if (!conn) throw new Error(`Connection not found: ${id}`);
    return conn;
  });

  registerHandler("connections.getValue", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    const conn = connQueries.getConnection(id);
    if (!conn) throw new Error(`Connection not found: ${id}`);

    let value: ConnectionValue | null = null;
    // Only token/plain_text/browser types have keychain entries
    if (conn.type === "token" || conn.type === "plain_text" || conn.type === "browser") {
      try {
        const raw = await getKeychainItem(id);
        if (raw) value = JSON.parse(raw) as ConnectionValue;
      } catch (err) {
        console.error("[connections] keychain read error:", err);
        throw new Error(err instanceof Error ? err.message : "Failed to read connection from Keychain");
      }
    }

    const result: ConnectionWithValue = { ...conn, value };
    return result;
  });

  registerHandler("connections.create", async (params) => {
    const p = params as CreateConnectionParams;
    if (!p?.name) throw new Error("name is required");
    if (!p?.type) throw new Error("type is required");

    const conn = connQueries.createConnection(p);

    // Store secret in Keychain for types that have a secret value
    if (p.value && (p.type === "token" || p.type === "plain_text" || p.type === "browser")) {
      try {
        await setKeychainItem(conn.id, JSON.stringify(p.value));
      } catch (err) {
        connQueries.deleteConnection(conn.id);
        throw new Error(err instanceof Error ? err.message : "Failed to store connection in Keychain");
      }
    }

    emit("connection.created", conn);
    return conn;
  });

  registerHandler("connections.update", async (params) => {
    const p = params as UpdateConnectionParams;
    if (!p?.id) throw new Error("id is required");

    const conn = connQueries.updateConnection(p);

    if (p.value && (conn.type === "token" || conn.type === "plain_text" || conn.type === "browser")) {
      try {
        await setKeychainItem(conn.id, JSON.stringify(p.value));
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "Failed to update connection in Keychain");
      }
    }

    // If this is a primary folder connection and the path changed, sync to project
    if (conn.type === "folder") {
      const config = conn.config as { isPrimary?: boolean; path?: string; projectId?: string };
      if (config.isPrimary && config.projectId && config.path && p.config) {
        const { syncPrimaryFolderToProject } = await import("../../connections/folder-sync.js");
        await syncPrimaryFolderToProject(conn.id, config.path, config.projectId);
      }
    }

    emit("connection.updated", conn);
    return conn;
  });

  registerHandler("connections.delete", async (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");

    const deleted = connQueries.deleteConnection(id); // throws E_CONNECTION_NOT_DELETABLE if primary folder
    if (deleted) {
      try {
        await deleteKeychainItem(id);
      } catch (err) {
        console.error("[connections] keychain delete error (non-fatal):", err);
      }
      emit("connection.deleted", { id });
    }
    return { deleted };
  });

  registerHandler("connections.listForScope", (params) => {
    const p = params as ListConnectionsByScopeParams;
    if (!p?.scopeType || !p?.scopeId) throw new Error("scopeType and scopeId are required");
    return connQueries.listConnectionsByScope(p);
  });

  registerHandler("connections.setScopesForEntity", (params) => {
    const { scopeType, scopeId, connectionIds } = params as {
      scopeType: "project" | "goal" | "job";
      scopeId: string;
      connectionIds: string[];
    };
    if (!scopeType || !scopeId) throw new Error("scopeType and scopeId are required");
    if (!Array.isArray(connectionIds)) throw new Error("connectionIds must be an array");
    return connQueries.setScopeBindingsForEntity({ scopeType, scopeId, connectionIds });
  });

  registerHandler("connections.count", (params) => {
    const { projectId } = params as { projectId?: string };
    return { count: connQueries.countConnections(projectId) };
  });

  registerHandler("connections.countAll", () => {
    return { count: connQueries.countConnections() };
  });

  // ─── Folder ─────────────────────────────────────────────────────────────────

  registerHandler("connections.createFolder", (params) => {
    const { projectId, path, isPrimary } = params as { projectId: string; path: string; isPrimary: boolean };
    if (!projectId) throw new Error("projectId is required");
    if (!path) throw new Error("path is required");

    if (isPrimary) {
      return connQueries.createPrimaryFolderConnection({ projectId, name: "Primary Folder", path });
    }

    return connQueries.createConnection({
      name: `Folder: ${path.split("/").pop() ?? path}`,
      type: "folder",
      config: { path, isPrimary: false, projectId },
      scopeType: "project",
      scopeId: projectId,
    });
  });

  // ─── MCP ─────────────────────────────────────────────────────────────────────

  registerHandler("connections.searchMcpRegistry", async (params) => {
    const { query, limit } = params as { query: string; limit?: number };
    if (!query) return [];
    return searchMcpRegistry(query, limit ?? 20);
  });

  // Unified service search: catalogue + MCP registry merge + "use as custom" fallback.
  registerHandler("connections.searchServices", async (params) => {
    const { query, limit, includeMcpRegistry } = params as {
      query: string;
      limit?: number;
      includeMcpRegistry?: boolean;
    };
    if (!query?.trim()) return [];
    return searchServices(query, { limit, includeMcpRegistry });
  });

  registerHandler("connections.installMcp", async (params) => {
    const { mcpServerId, version, scopes, name, installCommand } = params as {
      mcpServerId: string; version?: string;
      scopes?: Array<{scopeType: string; scopeId: string}>;
      name?: string;
      installCommand?: string[];
    };
    if (!mcpServerId) throw new Error("mcpServerId is required");

    const resolvedCommand = installCommand ?? [];

    const conn = connQueries.createConnection({
      name: name ?? (mcpServerId.split("/").pop() ?? mcpServerId),
      type: "mcp",
      config: { mcpServerId, version, transport: "stdio", installCommand: resolvedCommand },
      scopes: scopes as import("@openhelm/shared").ConnectionScopeBinding[],
    });

    const { installMcpServer } = await import("../../connections/mcp-installer.js");
    installMcpServer({ connectionId: conn.id, installCommand: resolvedCommand }).catch((err) => {
      console.error("[connections] MCP install error:", err);
    });

    return { connectionId: conn.id, installStatus: "pending" };
  });

  registerHandler("connections.getMcpOauthConfig", async (params) => {
    const { connectionId } = params as { connectionId: string };
    if (!connectionId) throw new Error("connectionId is required");
    const conn = connQueries.getConnection(connectionId);
    if (!conn) throw new Error(`Connection not found: ${connectionId}`);

    const config = conn.config as import("@openhelm/shared").McpConfig;
    const { getMcpOAuthConfig } = await import("../../connections/mcp-oauth-catalogue.js");
    const oauthConfig = getMcpOAuthConfig(config.mcpServerId ?? "");

    if (!oauthConfig) return { oauthRequired: false };
    return { oauthRequired: true, config: oauthConfig };
  });

  // Store a static token for an MCP or CLI connection (token-paste auth fallback).
  registerHandler("connections.setToken", async (params) => {
    const { connectionId, token } = params as { connectionId: string; token: string };
    if (!connectionId || !token) throw new Error("connectionId and token are required");

    await setKeychainItem(connectionId, JSON.stringify({ type: "token", value: token }));
    const conn = connQueries.updateConnection({ id: connectionId, authStatus: "authenticated" });
    emit("connection.updated", conn);
    return conn;
  });

  // Re-run the installer for an existing MCP or CLI connection.
  registerHandler("connections.reinstall", async (params) => {
    const { connectionId } = params as { connectionId: string };
    if (!connectionId) throw new Error("connectionId is required");

    const conn = connQueries.getConnection(connectionId);
    if (!conn) throw new Error(`Connection not found: ${connectionId}`);

    connQueries.updateConnection({ id: connectionId, installStatus: "pending", installError: null });

    if (conn.type === "mcp") {
      const config = conn.config as import("@openhelm/shared").McpConfig;
      const { installMcpServer } = await import("../../connections/mcp-installer.js");
      installMcpServer({ connectionId, installCommand: config.installCommand ?? [] }).catch((err) => {
        console.error("[connections] MCP reinstall error:", err);
      });
    } else if (conn.type === "cli") {
      const config = conn.config as import("@openhelm/shared").CliConfig;
      const { installCli } = await import("../../connections/cli-installer.js");
      installCli({ connectionId, installCommand: config.installCommand ?? [] }).catch((err) => {
        console.error("[connections] CLI reinstall error:", err);
      });
    } else {
      throw new Error(`Connection type "${conn.type}" does not support reinstall`);
    }

    return { connectionId, installStatus: "pending" };
  });

  registerHandler("connections.startMcpOauth", async (params) => {
    const { connectionId, redirectUri, authorizationEndpoint, clientId, scope } = params as {
      connectionId: string; redirectUri: string;
      authorizationEndpoint: string; clientId: string; scope: string;
    };
    if (!connectionId || !redirectUri) throw new Error("connectionId and redirectUri are required");
    const { startOAuthFlow } = await import("../../connections/oauth-flow.js");
    return startOAuthFlow({ connectionId, authorizationEndpoint, clientId, redirectUri, scope: scope ?? "" });
  });

  registerHandler("connections.completeMcpOauth", async (params) => {
    const { connectionId, code, state, tokenEndpoint, clientId, redirectUri } = params as {
      connectionId: string; code: string; state: string;
      tokenEndpoint: string; clientId: string; redirectUri: string;
    };
    if (!connectionId || !code || !state) throw new Error("connectionId, code, and state are required");
    const { completeOAuthFlow } = await import("../../connections/oauth-flow.js");
    return completeOAuthFlow({ state, code, tokenEndpoint, clientId, redirectUri });
  });

  registerHandler("connections.reauthMcp", async (params) => {
    const { connectionId, redirectUri, authorizationEndpoint, clientId, scope } = params as {
      connectionId: string; redirectUri: string;
      authorizationEndpoint: string; clientId: string; scope: string;
    };
    if (!connectionId || !redirectUri) throw new Error("connectionId and redirectUri are required");
    const { startOAuthFlow } = await import("../../connections/oauth-flow.js");
    return startOAuthFlow({ connectionId, authorizationEndpoint, clientId, redirectUri, scope: scope ?? "" });
  });

  // ─── CLI ─────────────────────────────────────────────────────────────────────

  registerHandler("connections.searchCliRegistry", (params) => {
    const { query } = params as { query: string };
    const catalogue = getCliCatalogue();
    if (!query?.trim()) return catalogue;
    const q = query.toLowerCase();
    return catalogue.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
  });

  registerHandler("connections.installCli", async (params) => {
    const { cliId, scopes } = params as { cliId: string; scopes?: Array<{scopeType: string; scopeId: string}> };
    if (!cliId) throw new Error("cliId is required");

    const entry = getCliCatalogue().find((e) => e.id === cliId);
    if (!entry) throw new Error(`CLI not found in catalogue: ${cliId}`);

    const conn = connQueries.createConnection({
      name: entry.name,
      type: "cli",
      config: {
        cliId: entry.id,
        packageManager: entry.packageManager,
        installCommand: entry.installCommand,
        authFilePaths: entry.authFilePaths,
        authCommand: entry.authCommand,
      },
      scopes: scopes as import("@openhelm/shared").ConnectionScopeBinding[],
    });

    const { installCli } = await import("../../connections/cli-installer.js");
    installCli({ connectionId: conn.id, installCommand: entry.installCommand }).catch((err) => {
      console.error("[connections] CLI install error:", err);
    });

    return { connectionId: conn.id, installStatus: "pending" };
  });

  registerHandler("connections.startCliAuth", async (params) => {
    const { connectionId } = params as { connectionId: string };
    if (!connectionId) throw new Error("connectionId is required");
    const { startCliAuth } = await import("../../connections/cli-installer.js");
    return startCliAuth({ connectionId });
  });

  registerHandler("connections.completeCliAuth", async (params) => {
    const { connectionId } = params as { connectionId: string };
    if (!connectionId) throw new Error("connectionId is required");
    // Mark as authenticated once the frontend confirms
    const conn = connQueries.updateConnection({ id: connectionId, authStatus: "authenticated" });
    emit("connection.updated", conn);
    return conn;
  });

  // ─── Browser setup ──────────────────────────────────────────────────────────

  registerHandler("connections.setupBrowser", async (params) => {
    // Support both connectionId (new) and credentialId (deprecated)
    const p = params as SetupBrowserProfileParams;
    const connectionId = p.connectionId ?? p.credentialId;
    if (!connectionId) throw new Error("connectionId is required");

    const existing = activeMonitors.get(connectionId);
    if (existing) existing.stop();
    activeMonitors.delete(connectionId);

    const conn = connQueries.getConnection(connectionId);
    if (!conn) throw new Error(`Connection not found: ${connectionId}`);

    const profileName = `conn-${connectionId}`;
    const profilesRoot = join(
      process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm"),
      "profiles",
    );
    const profileDir = join(profilesRoot, profileName);
    const metaPath = join(profilesRoot, "profiles.json");

    mkdirSync(profileDir, { recursive: true });

    const firstRunPath = join(profileDir, "First Run");
    if (!existsSync(firstRunPath)) writeFileSync(firstRunPath, "");

    let meta: Record<string, unknown> = {};
    try {
      if (existsSync(metaPath)) meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch { /* fresh */ }

    if (!meta[profileName]) {
      meta[profileName] = {
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        notes: `Browser profile for connection "${conn.name}"`,
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    if (conn.browserProfileName !== profileName) {
      connQueries.updateConnection({ id: connectionId, browserProfileName: profileName });
    }

    const loginUrl = (conn.config as { loginUrl?: string }).loginUrl ?? p.loginUrl;
    const url = buildInstructionPageUrl(loginUrl);

    const chromeArgs = [
      `--user-data-dir=${profileDir}`,
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--disable-session-crashed-bubble",
      "--disable-features=ChromeWhatsNewUI",
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
            resolve({ profileName, launched: false, message: `Failed to launch Chrome: ${err.message}` });
            return;
          }

          const monitor = new BrowserSessionMonitor(connectionId, profileDir);
          activeMonitors.set(connectionId, monitor);
          monitor.start();
          emit("connection.browserLaunched", { connectionId });

          resolve({
            profileName,
            launched: true,
            message: "Chrome opened. Log in to your site, then quit Chrome (⌘Q) when done.",
          });
        },
      );
    });
  });

  registerHandler("connections.cancelBrowserSetup", (params) => {
    const { connectionId, credentialId } = params as { connectionId?: string; credentialId?: string };
    const id = connectionId ?? credentialId;
    if (!id) throw new Error("connectionId is required");
    const monitor = activeMonitors.get(id);
    if (monitor) {
      monitor.stop();
      activeMonitors.delete(id);
    }
    return { cancelled: true };
  });

  // ─── Backward-compat aliases for old credentials.* IPC method names ─────────

  const legacyAliases: Record<string, string> = {
    "credentials.list": "connections.list",
    "credentials.listAll": "connections.listAll",
    "credentials.get": "connections.get",
    "credentials.getValue": "connections.getValue",
    "credentials.create": "connections.create",
    "credentials.update": "connections.update",
    "credentials.delete": "connections.delete",
    "credentials.listForScope": "connections.listForScope",
    "credentials.setScopesForEntity": "connections.setScopesForEntity",
    "credentials.count": "connections.count",
    "credentials.countAll": "connections.countAll",
    "credential.setupBrowserProfile": "connections.setupBrowser",
    "credential.cancelBrowserSetup": "connections.cancelBrowserSetup",
  };

  // We don't re-register here — the alias resolution happens in the api.ts transport layer
  // by mapping old method names to new ones. The agent handler registry only needs new names.
  void legacyAliases; // Used by transport layer
}
