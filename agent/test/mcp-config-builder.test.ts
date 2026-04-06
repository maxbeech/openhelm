import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock the browser-setup module to control venv readiness
vi.mock("../src/mcp-servers/browser-setup.js", () => ({
  getBrowserMcpPaths: vi.fn(),
}));

import { getBrowserMcpPaths } from "../src/mcp-servers/browser-setup.js";
import {
  buildMcpConfig,
  writeMcpConfigFile,
  removeMcpConfigFile,
  cleanupOrphanedConfigs,
  buildBrowserCredentialsNotice,
} from "../src/mcp-servers/mcp-config-builder.js";

const mockGetBrowserMcpPaths = vi.mocked(getBrowserMcpPaths);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildMcpConfig", () => {
  it("returns null when browser venv is not ready", () => {
    mockGetBrowserMcpPaths.mockReturnValue(null);
    expect(buildMcpConfig("run-1")).toBeNull();
  });

  it("returns valid config when browser venv is ready", () => {
    mockGetBrowserMcpPaths.mockReturnValue({
      pythonPath: "/path/to/.venv/bin/python",
      serverModule: "/path/to/src/server.py",
      cwd: "/path/to/browser",
    });

    const config = buildMcpConfig("run-1");
    expect(config).not.toBeNull();
    expect(config!.mcpServers).toHaveProperty("openhelm-browser");

    const entry = config!.mcpServers["openhelm-browser"];
    expect(entry.command).toBe("/path/to/.venv/bin/python");
    expect(entry.args).toContain("/path/to/src/server.py");
    expect(entry.args).toContain("--transport");
    expect(entry.args).toContain("stdio");
    expect(entry.cwd).toBe("/path/to/browser");
  });

  it("includes --run-id arg with the provided run ID", () => {
    mockGetBrowserMcpPaths.mockReturnValue({
      pythonPath: "/path/to/.venv/bin/python",
      serverModule: "/path/to/src/server.py",
      cwd: "/path/to/browser",
    });

    const config = buildMcpConfig("test-run-xyz");
    const args = config!.mcpServers["openhelm-browser"].args;
    expect(args).toContain("--run-id");
    expect(args).toContain("test-run-xyz");
  });

  it("includes --credentials-file arg when credentialsFilePath is provided", () => {
    mockGetBrowserMcpPaths.mockReturnValue({
      pythonPath: "/path/to/.venv/bin/python",
      serverModule: "/path/to/src/server.py",
      cwd: "/path/to/browser",
    });

    const config = buildMcpConfig("run-1", "/tmp/creds.json");
    expect(config).not.toBeNull();

    const args = config!.mcpServers["openhelm-browser"].args;
    expect(args).toContain("--credentials-file");
    expect(args).toContain("/tmp/creds.json");
  });

  it("does not include --credentials-file when no path provided", () => {
    mockGetBrowserMcpPaths.mockReturnValue({
      pythonPath: "/path/to/.venv/bin/python",
      serverModule: "/path/to/src/server.py",
      cwd: "/path/to/browser",
    });

    const config = buildMcpConfig("run-1");
    const args = config!.mcpServers["openhelm-browser"].args;
    expect(args).not.toContain("--credentials-file");
  });
});

describe("writeMcpConfigFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    // Override the config dir by setting env var
    process.env.OPENHELM_DATA_DIR = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENHELM_DATA_DIR;
  });

  it("returns null when no MCP servers are available", () => {
    mockGetBrowserMcpPaths.mockReturnValue(null);
    // Re-import to pick up the env var — but since the module was already imported,
    // the MCP_CONFIG_DIR is already set. This test just verifies the null path.
    expect(writeMcpConfigFile("test-run-1")).toBeNull();
  });
});

describe("removeMcpConfigFile", () => {
  it("does not throw when file does not exist", () => {
    expect(() => removeMcpConfigFile("/nonexistent/path.json")).not.toThrow();
  });

  it("removes an existing file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-rm-test-"));
    const filePath = join(tempDir, "test.json");
    require("fs").writeFileSync(filePath, "{}");
    expect(existsSync(filePath)).toBe(true);

    removeMcpConfigFile(filePath);
    expect(existsSync(filePath)).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("writeMcpConfigFile (happy path)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-write-test-"));
    process.env.OPENHELM_DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENHELM_DATA_DIR;
  });

  it("writes valid JSON config and returns the file path", async () => {
    // vi.mock factory is still registered after resetModules — re-import picks it up
    const { getBrowserMcpPaths: freshGetPaths } =
      await import("../src/mcp-servers/browser-setup.js");
    vi.mocked(freshGetPaths).mockReturnValue({
      pythonPath: "/venv/bin/python",
      serverModule: "/server.py",
      cwd: "/browser",
    });

    const { writeMcpConfigFile: freshWrite } =
      await import("../src/mcp-servers/mcp-config-builder.js");

    const configPath = freshWrite("run-abc");

    expect(configPath).not.toBeNull();
    expect(configPath).toContain("run-run-abc.json");
    expect(existsSync(configPath!)).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath!, "utf8"));
    expect(parsed.mcpServers["openhelm-browser"].command).toBe("/venv/bin/python");
    expect(parsed.mcpServers["openhelm-browser"].args).toContain("/server.py");
    expect(parsed.mcpServers["openhelm-browser"].cwd).toBe("/browser");
  });
});

describe("buildBrowserCredentialsNotice", () => {
  it("says no credentials when list is empty", () => {
    const notice = buildBrowserCredentialsNotice([]);
    expect(notice).toContain("No credentials are bound");
    expect(notice).toContain("WILL fail");
    expect(notice).toContain("spawn_browser");
  });

  it("lists credentials by name with profile hints when present", () => {
    const notice = buildBrowserCredentialsNotice([
      { name: "X (Twitter)", type: "username_password", profileName: "cred-abc123" },
      { name: "Reddit", type: "token" },
    ]);
    expect(notice).toContain('"X (Twitter)" (username_password)');
    expect(notice).toContain('spawn_browser(profile="cred-abc123")');
    expect(notice).toContain('"Reddit" (token)');
    expect(notice).toContain("check_session");
  });
});

describe("cleanupOrphanedConfigs", () => {
  it("does not throw when config directory does not exist", () => {
    expect(() => cleanupOrphanedConfigs()).not.toThrow();
  });

  it("removes run-*.json files from the mcp-configs directory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-cleanup-test-"));
    const configDir = join(tempDir, "mcp-configs");
    mkdirSync(configDir);
    writeFileSync(join(configDir, "run-111.json"), "{}");
    writeFileSync(join(configDir, "run-222.json"), "{}");

    process.env.OPENHELM_DATA_DIR = tempDir;
    vi.resetModules();
    const { cleanupOrphanedConfigs: freshCleanup } =
      await import("../src/mcp-servers/mcp-config-builder.js");

    freshCleanup();

    expect(existsSync(join(configDir, "run-111.json"))).toBe(false);
    expect(existsSync(join(configDir, "run-222.json"))).toBe(false);

    delete process.env.OPENHELM_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });
});
