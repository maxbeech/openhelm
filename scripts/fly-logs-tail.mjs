#!/usr/bin/env node
/**
 * fly-logs-tail.mjs — stream `fly logs` for a target app into stdout so
 * worker-side debug output shows up in the same terminal as `dev:cloud`.
 *
 * Why: `dev:cloud` points VITE_WORKER_URL at the production worker on
 * Fly, so the Vite terminal otherwise only shows frontend logs. Without
 * worker logs you can't see why a voice RPC / chat tool call failed.
 *
 * Behaviour:
 *  - Skips silently (exit 0) if the fly CLI isn't installed or the user
 *    isn't authenticated. Dev should keep working without fly access.
 *  - Prefixes every line with [worker] so it's obvious which process it
 *    came from when interleaved with Vite output.
 *  - Forwards SIGINT/SIGTERM to the child so Ctrl-C tears it down with
 *    the rest of the concurrently group.
 */

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const appName = process.argv[2];
if (!appName) {
  console.error("[worker-logs] usage: fly-logs-tail.mjs <fly-app-name>");
  process.exit(2);
}

// Prefer `fly`, fall back to `flyctl`. Both ship with the fly CLI.
function resolveFlyBinary() {
  for (const bin of ["fly", "flyctl"]) {
    const which = spawnSync("which", [bin], { stdio: "pipe" });
    if (which.status === 0 && which.stdout.toString().trim()) {
      return bin;
    }
  }
  return null;
}

const flyBin = resolveFlyBinary();
if (!flyBin) {
  console.error(
    "[worker-logs] fly CLI not found — skipping remote log stream. " +
      "Install with `brew install flyctl` and run `fly auth login` to see worker logs here.",
  );
  // Exit 0 so `concurrently --kill-others-on-fail` doesn't tear down vite.
  // Keep the process alive indefinitely (concurrently will manage cleanup).
  setInterval(() => {}, 30000); // 30s intervals to avoid spinning
}

if (flyBin) {
  const proc = spawn(flyBin, ["logs", "--app", appName], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const out = createInterface({ input: proc.stdout });
  const err = createInterface({ input: proc.stderr });
  out.on("line", (line) => process.stdout.write(`[worker] ${line}\n`));
  err.on("line", (line) => process.stderr.write(`[worker] ${line}\n`));

  proc.on("exit", (code) => {
    if (code !== 0) {
      console.error(
        `[worker-logs] fly logs exited with code ${code}. ` +
          "Are you logged in? Run `fly auth login` and retry.",
      );
    }
    process.exit(code ?? 0);
  });

  const forward = (sig) => () => {
    proc.kill(sig);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
}
