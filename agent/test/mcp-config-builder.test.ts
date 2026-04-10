import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
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

/**
 * Create real files/dirs for a fake browser MCP paths bundle.
 * `buildMcpConfig` validates paths with `existsSync` before including the
 * browser server in the config, so tests that exercise the happy path need
 * the mocked paths to actually exist on disk.
 */
function makeRealBrowserPaths() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-browser-paths-"));
  const pythonPath = join(dir, "python");
  const serverModule = join(dir, "server.py");
  const cwd = join(dir, "cwd");
  writeFileSync(pythonPath, "");
  writeFileSync(serverModule, "");
  mkdirSync(cwd);
  return { dir, paths: { pythonPath, serverModule, cwd } };
}

let _tempBrowserPathsDir: string | null = null;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  if (_tempBrowserPathsDir) {
    rmSync(_tempBrowserPathsDir, { recursive: true, force: true });
    _tempBrowserPathsDir = null;
  }
});

describe("buildMcpConfig", () => {
  it("returns null when browser venv is not ready", () => {
    mockGetBrowserMcpPaths.mockReturnValue(null);
    expect(buildMcpConfig("run-1")).toBeNull();
  });

  it("returns valid config when browser venv is ready", () => {
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;
    mockGetBrowserMcpPaths.mockReturnValue(paths);

    const config = buildMcpConfig("run-1");
    expect(config).not.toBeNull();
    expect(config!.mcpServers).toHaveProperty("openhelm_browser");

    const entry = config!.mcpServers["openhelm_browser"];
    expect(entry.command).toBe(paths.pythonPath);
    expect(entry.args).toContain(paths.serverModule);
    expect(entry.args).toContain("--transport");
    expect(entry.args).toContain("stdio");
    expect(entry.cwd).toBe(paths.cwd);
  });

  it("uses the `openhelm_browser` server key (underscore, not hyphen) to avoid tool-name hallucinations", () => {
    // Round 8 regression guard: Claude reliably hallucinates the server name
    // as `openhelm_browser` (underscore) because `mcp__SERVER__TOOL` makes
    // underscores the natural delimiter. The server key MUST match.
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;
    mockGetBrowserMcpPaths.mockReturnValue(paths);

    const config = buildMcpConfig("run-1");
    expect(Object.keys(config!.mcpServers)).toContain("openhelm_browser");
    expect(Object.keys(config!.mcpServers)).not.toContain("openhelm-browser");
  });

  it("includes --run-id arg with the provided run ID", () => {
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;
    mockGetBrowserMcpPaths.mockReturnValue(paths);

    const config = buildMcpConfig("test-run-xyz");
    const args = config!.mcpServers["openhelm_browser"].args;
    expect(args).toContain("--run-id");
    expect(args).toContain("test-run-xyz");
  });

  it("includes --credentials-file arg when credentialsFilePath is provided", () => {
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;
    mockGetBrowserMcpPaths.mockReturnValue(paths);

    const config = buildMcpConfig("run-1", "/tmp/creds.json");
    expect(config).not.toBeNull();

    const args = config!.mcpServers["openhelm_browser"].args;
    expect(args).toContain("--credentials-file");
    expect(args).toContain("/tmp/creds.json");
  });

  it("does not include --credentials-file when no path provided", () => {
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;
    mockGetBrowserMcpPaths.mockReturnValue(paths);

    const config = buildMcpConfig("run-1");
    const args = config!.mcpServers["openhelm_browser"].args;
    expect(args).not.toContain("--credentials-file");
  });

  it("skips the browser server when referenced paths do not exist", () => {
    // Round 6 path validation: bad paths should drop the server entry rather
    // than letting Claude Code start with a broken MCP config.
    mockGetBrowserMcpPaths.mockReturnValue({
      pythonPath: "/does/not/exist/python",
      serverModule: "/does/not/exist/server.py",
      cwd: "/does/not/exist/cwd",
    });
    const config = buildMcpConfig("run-1");
    // config may still include other bundled servers (openhelm_data) — just
    // assert the browser server was excluded.
    if (config) {
      expect(Object.keys(config.mcpServers)).not.toContain("openhelm_browser");
    }
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
    // Use real paths so buildMcpConfig's existsSync validation passes.
    const { dir, paths } = makeRealBrowserPaths();
    _tempBrowserPathsDir = dir;

    // vi.mock factory is still registered after resetModules — re-import picks it up
    const { getBrowserMcpPaths: freshGetPaths } =
      await import("../src/mcp-servers/browser-setup.js");
    vi.mocked(freshGetPaths).mockReturnValue(paths);

    const { writeMcpConfigFile: freshWrite } =
      await import("../src/mcp-servers/mcp-config-builder.js");

    const configPath = freshWrite("run-abc");

    expect(configPath).not.toBeNull();
    expect(configPath).toContain("run-run-abc.json");
    expect(existsSync(configPath!)).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath!, "utf8"));
    expect(parsed.mcpServers["openhelm_browser"].command).toBe(paths.pythonPath);
    expect(parsed.mcpServers["openhelm_browser"].args).toContain(paths.serverModule);
    expect(parsed.mcpServers["openhelm_browser"].cwd).toBe(paths.cwd);
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

  it("removes run-*.json files from the mcp-configs directory when they are older than the grace window", async () => {
    // Round 6 "smart cleanup": only files older than 5 minutes are removed,
    // to avoid a race where an in-flight run's config is deleted by a sibling
    // process during cleanup at startup. Backdate mtimes so the test data
    // clears the grace window.
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-cleanup-test-"));
    const configDir = join(tempDir, "mcp-configs");
    mkdirSync(configDir);
    const stalePaths = [join(configDir, "run-111.json"), join(configDir, "run-222.json")];
    for (const p of stalePaths) {
      writeFileSync(p, "{}");
      // Set atime/mtime to 10 minutes ago (well past the 5-minute grace window).
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      utimesSync(p, tenMinutesAgo, tenMinutesAgo);
    }

    process.env.OPENHELM_DATA_DIR = tempDir;
    vi.resetModules();
    const { cleanupOrphanedConfigs: freshCleanup } =
      await import("../src/mcp-servers/mcp-config-builder.js");

    freshCleanup();

    for (const p of stalePaths) {
      expect(existsSync(p)).toBe(false);
    }

    delete process.env.OPENHELM_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("preserves recent run-*.json files inside the 5-minute grace window", async () => {
    // Regression guard for Round 6: fresh configs must NOT be swept by
    // cleanupOrphanedConfigs, otherwise an in-flight run's config could be
    // deleted out from under Claude Code, causing "No such tool available".
    const tempDir = mkdtempSync(join(tmpdir(), "mcp-cleanup-fresh-test-"));
    const configDir = join(tempDir, "mcp-configs");
    mkdirSync(configDir);
    const freshPath = join(configDir, "run-fresh.json");
    writeFileSync(freshPath, "{}");

    process.env.OPENHELM_DATA_DIR = tempDir;
    vi.resetModules();
    const { cleanupOrphanedConfigs: freshCleanup } =
      await import("../src/mcp-servers/mcp-config-builder.js");

    freshCleanup();

    expect(existsSync(freshPath)).toBe(true);

    delete process.env.OPENHELM_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });
});
