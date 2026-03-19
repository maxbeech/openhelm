/**
 * patch-bundle.mjs
 *
 * Run after `tauri build` (via `npm run tauri:build`) to patch Contents/MacOS/:
 *
 * 1. Writes {"type":"commonjs"} as package.json so Node.js doesn't walk up and
 *    find the workspace-root package.json (which has "type":"module") and
 *    misinterpret the CJS agent bundle as ESM.
 *
 * 2. Writes .node-bin-dir containing the directory of the node binary used to
 *    build this app. The Rust shell reads this at startup and prepends it to PATH
 *    before spawning the agent sidecar, guaranteeing the agent runs with the same
 *    Node.js version that compiled bundled-node-modules/better-sqlite3.node.
 *    Without this, a version manager (NVM, fnm) might shadow Homebrew and cause a
 *    NODE_MODULE_VERSION mismatch crash.
 */
import { writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const macosDir = resolve(
  __dirname,
  "..",
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "OpenHelm.app",
  "Contents",
  "MacOS",
);

if (!existsSync(macosDir)) {
  console.error(`[patch-bundle] MacOS dir not found: ${macosDir}`);
  console.error("[patch-bundle] Run `npm run tauri build` first.");
  process.exit(1);
}

// 1. CJS module type marker.
writeFileSync(resolve(macosDir, "package.json"), JSON.stringify({ type: "commonjs" }));
console.log("[patch-bundle] Written package.json (CommonJS marker)");

// 2. Build-time node binary directory — used by the Rust shell to pick the right
//    Node.js at runtime (same version used to compile better-sqlite3).
const nodeBinDir = dirname(process.execPath);
writeFileSync(resolve(macosDir, ".node-bin-dir"), nodeBinDir);
console.log(`[patch-bundle] Written .node-bin-dir → ${nodeBinDir}`);
