/**
 * Goose binary detection.
 *
 * Checks common install paths and PATH, extracts version via `goose --version`,
 * and runs a minimal smoke-test to verify the binary is functional.
 *
 * Minimum supported version: 1.10.0 (first release with --output-format stream-json)
 */

import { execFile, spawn } from "child_process";
import { createInterface } from "readline";
import { existsSync } from "fs";
import { promisify } from "util";
import type { BackendInfo } from "../types.js";

const execFileAsync = promisify(execFile);

export const MIN_GOOSE_VERSION = "1.10.0";

/** Locations to check for the Goose binary, in priority order */
const SEARCH_LOCATIONS = [
  // Homebrew (Apple Silicon)
  "/opt/homebrew/bin/goose",
  // Homebrew (Intel)
  "/usr/local/bin/goose",
  // Cargo install
  `${process.env.HOME}/.cargo/bin/goose`,
  // pip / pipx / manual installs
  `${process.env.HOME}/.local/bin/goose`,
];

/**
 * Compare two semver version strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareGooseSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Find the Goose binary via `which goose`.
 * Returns the path if found, null otherwise.
 */
async function findViaWhich(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["goose"], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Find the Goose binary in common install locations.
 * Returns the first existing path, or null.
 */
function findInLocations(): string | null {
  for (const loc of SEARCH_LOCATIONS) {
    if (existsSync(loc)) return loc;
  }
  return null;
}

/**
 * Get the version string from a Goose binary.
 * `goose --version` outputs "goose 1.29.1" (clap format).
 * Returns the semver string or null on failure.
 */
export async function getGooseVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 10000 });
    // "goose 1.29.1" or "1.29.1"
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Detect the Goose binary. Returns null if not found or below minimum version.
 */
export async function detectGoose(manualPath?: string): Promise<{ path: string; version: string } | null> {
  const candidates: Array<string | null> = manualPath
    ? [manualPath]
    : [await findViaWhich(), findInLocations()];

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const version = await getGooseVersion(candidate);
    if (!version) continue;
    if (compareGooseSemver(version, MIN_GOOSE_VERSION) < 0) {
      console.error(`[goose-detector] version ${version} at ${candidate} is below minimum ${MIN_GOOSE_VERSION}`);
      continue;
    }
    return { path: candidate, version };
  }
  return null;
}

export interface GooseHealthResult {
  healthy: boolean;
  authenticated: boolean;
  error?: string;
}

/**
 * Check if Goose is functional by running a minimal smoke-test.
 * Passes a no-op prompt and verifies it exits cleanly.
 */
export async function checkGooseHealth(binaryPath: string): Promise<GooseHealthResult> {
  return new Promise((resolve) => {
    const child = spawn(
      binaryPath,
      ["run", "--output-format", "stream-json", "--no-session", "-i", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (d: Buffer) => stderrChunks.push(d.toString()));

    let gotComplete = false;
    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line: string) => {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "complete") gotComplete = true;
      } catch {
        // ignore
      }
    });

    child.stdin?.on("error", () => {});
    child.stdin?.write("Reply with the word OK and nothing else.");
    child.stdin?.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ healthy: false, authenticated: false, error: "Goose health check timed out after 30s." });
    }, 30_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (gotComplete || code === 0) {
        resolve({ healthy: true, authenticated: true });
        return;
      }
      const stderr = stderrChunks.join("").trim();
      const isAuthError = /not\s+logged\s+in|unauthenticated|unauthorized|api\s+key/i.test(stderr);
      if (isAuthError) {
        resolve({ healthy: false, authenticated: false, error: "Goose is not authenticated. Set ANTHROPIC_API_KEY or configure a provider." });
        return;
      }
      resolve({
        healthy: false,
        authenticated: true,
        error: `Goose health check failed: ${stderr || `exit code ${code}`}`.slice(0, 300),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ healthy: false, authenticated: false, error: `Goose health check error: ${err.message}` });
    });
  });
}

/**
 * Build a BackendInfo object for the Goose backend.
 * Returns null if Goose is not found or unhealthy.
 */
export async function buildGooseBackendInfo(manualPath?: string): Promise<BackendInfo | null> {
  const detected = await detectGoose(manualPath);
  if (!detected) return null;
  const health = await checkGooseHealth(detected.path);
  return {
    name: "goose",
    version: detected.version,
    path: detected.path,
    healthy: health.healthy,
    authenticated: health.authenticated,
  };
}
