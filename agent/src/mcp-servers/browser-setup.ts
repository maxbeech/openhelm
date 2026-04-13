/**
 * Manages the Python virtual environment for the built-in browser MCP server.
 *
 * On first use, detects Python 3.10+, creates a venv, and installs dependencies.
 * Subsequent calls are near-instant (just checks if .venv/bin/python exists).
 *
 * Paths:
 * - Dev:  agent/dist/agent.js  →  __dirname = agent/dist/
 *         →  ../mcp-servers/browser/ = agent/mcp-servers/browser/
 * - Prod: bundled as Tauri resource at Contents/Resources/mcp-servers/browser/
 *         Venv is created at ~/.openhelm/browser-venv/ (outside app bundle)
 */

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Resolve the browser MCP source directory.
 * - Dev: join(__dirname, "..", "mcp-servers", "browser") → agent/mcp-servers/browser/
 * - Prod: join(__dirname, "..", "Resources", "mcp-servers", "browser") → Contents/Resources/mcp-servers/browser/
 */
function resolveBrowserMcpDir(): string {
  if (process.env.OPENHELM_BROWSER_MCP_DIR) {
    return process.env.OPENHELM_BROWSER_MCP_DIR;
  }
  // Production: Tauri bundles resources at Contents/Resources/ (macOS)
  const prodPath = join(__dirname, "..", "Resources", "mcp-servers", "browser");
  if (existsSync(join(prodPath, "src", "server.py"))) return prodPath;
  // Dev: relative to agent/dist/
  return join(__dirname, "..", "mcp-servers", "browser");
}

const BROWSER_MCP_DIR = resolveBrowserMcpDir();

// Venv lives outside the app bundle to avoid macOS code-signing issues.
// In dev, it goes inside the source dir (as before). In prod, it goes in ~/.openhelm/.
const DATA_DIR = process.env.OPENHELM_DATA_DIR ?? join(homedir(), ".openhelm");
const isProduction = existsSync(join(__dirname, "..", "Resources"));
const VENV_DIR = isProduction
  ? join(DATA_DIR, "browser-venv")
  : join(BROWSER_MCP_DIR, ".venv");
const VENV_PYTHON = join(VENV_DIR, "bin", "python");
const REQUIREMENTS_TXT = join(BROWSER_MCP_DIR, "requirements.txt");
const SERVER_MODULE = join(BROWSER_MCP_DIR, "src", "server.py");

export interface BrowserMcpPaths {
  /** Path to the venv Python binary */
  pythonPath: string;
  /** Path to server.py entry point */
  serverModule: string;
  /** Working directory for the MCP server */
  cwd: string;
}

/**
 * Detect a usable Python 3.10–3.13 binary on the system.
 * Tries specific version binaries first (preferred) before falling back to
 * the generic `python3` / `python`. Python 3.14+ is excluded because
 * pydantic-core (a transitive dependency) requires PyO3 which only supports ≤3.13.
 * Returns the binary name or null.
 */
export async function detectPython(): Promise<string | null> {
  // Try specific versions from newest-compatible down, then generic binaries.
  const candidates = [
    "python3.13", "python3.12", "python3.11", "python3.10",
    "python3", "python",
  ];
  for (const bin of candidates) {
    try {
      const { stdout } = await execFileAsync(bin, ["--version"]);
      const match = stdout.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
        // Accept 3.10–3.13 (3.14+ breaks pydantic-core / PyO3 at time of writing)
        if (major === 3 && minor >= 10 && minor <= 13) return bin;
      }
    } catch {
      // binary not found — try next
    }
  }
  return null;
}

/** Check if the venv exists and is usable */
export function isVenvReady(): boolean {
  return existsSync(VENV_PYTHON);
}

/** Check if the browser MCP source directory exists */
export function isSourceAvailable(): boolean {
  return existsSync(SERVER_MODULE) && existsSync(REQUIREMENTS_TXT);
}

/**
 * Create the venv and install dependencies. Idempotent — skips if already ready.
 * Throws if Python 3.10+ is not available or pip install fails.
 */
export async function setupBrowserMcpVenv(): Promise<BrowserMcpPaths> {
  if (isVenvReady()) {
    return { pythonPath: VENV_PYTHON, serverModule: SERVER_MODULE, cwd: BROWSER_MCP_DIR };
  }

  if (!isSourceAvailable()) {
    throw new Error(
      `Browser MCP source not found at ${BROWSER_MCP_DIR}. ` +
      `Ensure the agent/mcp-servers/browser/ directory exists.`,
    );
  }

  const pythonBin = await detectPython();
  if (!pythonBin) {
    throw new Error(
      "Python 3.10+ is required for browser automation. " +
      "Install from https://python.org or via: brew install python@3",
    );
  }

  console.error("[browser-mcp] creating virtual environment...");
  await execFileAsync(pythonBin, ["-m", "venv", VENV_DIR]);

  console.error("[browser-mcp] installing dependencies (this may take a minute)...");
  await execFileAsync(
    VENV_PYTHON,
    ["-m", "pip", "install", "--quiet", "-r", REQUIREMENTS_TXT],
    { cwd: BROWSER_MCP_DIR, timeout: 300_000 },
  );

  console.error("[browser-mcp] setup complete");
  return { pythonPath: VENV_PYTHON, serverModule: SERVER_MODULE, cwd: BROWSER_MCP_DIR };
}

/**
 * Return paths if the venv is ready, or null if setup is needed.
 * Does NOT trigger setup — call setupBrowserMcpVenv() for that.
 */
export function getBrowserMcpPaths(): BrowserMcpPaths | null {
  if (!isVenvReady()) return null;
  return { pythonPath: VENV_PYTHON, serverModule: SERVER_MODULE, cwd: BROWSER_MCP_DIR };
}

/**
 * Pre-warm the browser MCP Python import graph into OS disk cache so the
 * first real ``spawn_browser`` call pays a fast (<2s) cold-start instead of
 * the 15–25s nodriver+stealth+handler graph cold import. Call fire-and-forget
 * at agent startup.
 *
 * Implementation: spawn the venv Python with ``-c "import <graph>"``. Python
 * parses the bytecode, walks imports, and exits. The next ``uv.start(config)``
 * call elsewhere benefits from the warm .pyc cache in the filesystem page
 * cache. This is the cheapest reliable way we've found to defeat the MCP
 * registration race condition without restructuring the server module.
 *
 * Budgeted: 30s hard ceiling. If pre-warm itself runs slow, the next job
 * run's MCP init will still succeed (the imports are progressively hotter
 * after each attempt).
 *
 * Non-fatal — failures are logged and ignored.
 */
export async function preWarmBrowserMcp(): Promise<void> {
  try {
    const paths = getBrowserMcpPaths();
    if (!paths) return;
    // Import the same module graph server.py imports at top level. Any
    // ImportError is silently absorbed by the Python process — we only
    // care that the modules land in disk cache.
    const preImport = [
      "import nodriver as uc",
      "import fastmcp",
      // These are the browser MCP handler modules — the expensive ones.
      "import sys; sys.path.insert(0, 'src')",
      "import browser_manager",
      "import dom_handler",
      "import stealth",
      "import profile_manager",
      "import process_cleanup",
      "import captcha_detector",
      "import network_interceptor",
    ].join("; ");
    await execFileAsync(
      paths.pythonPath,
      ["-c", preImport],
      { cwd: paths.cwd, timeout: 30_000 },
    );
    console.error("[browser-mcp] pre-warmed Python import graph");
  } catch (err) {
    // Non-fatal: if pre-warm fails the actual MCP spawn will still work,
    // just with a longer cold-start budget.
    console.error("[browser-mcp] pre-warm failed (non-fatal):", err);
  }
}
