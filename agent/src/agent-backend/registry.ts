/**
 * Backend registry — maps backend names to AgentBackend instances and
 * provides the active backend for the current runtime mode.
 *
 * In local mode (Community/Business tiers), the active backend is ClaudeCodeBackend.
 * In cloud mode (Cloud tier, Phase 2+), the active backend is GooseBackend.
 *
 * The registry lazy-initialises a ClaudeCodeBackend as the default so that
 * modules calling getBackend() work correctly in tests without needing to
 * explicitly register a backend in test setup.
 */

import type { AgentBackend } from "./types.js";

const backends = new Map<string, AgentBackend>();
let _activeBackend: AgentBackend | null = null;

/** Register a backend implementation. Call this at agent startup. */
export function registerBackend(backend: AgentBackend): void {
  backends.set(backend.name, backend);
  _activeBackend = backend;
}

/**
 * Get the active backend for the current runtime mode.
 * Falls back to a lazily-constructed ClaudeCodeBackend if none is registered
 * (e.g. in tests that don't go through agent/src/index.ts).
 */
export function getBackend(name?: string): AgentBackend {
  if (name) {
    const b = backends.get(name);
    if (!b) throw new Error(`AgentBackend "${name}" is not registered`);
    return b;
  }

  if (_activeBackend) return _activeBackend;

  // Lazy default: ClaudeCodeBackend (local mode)
  // Dynamic import avoids circular dependency; synchronous require is fine
  // here since this code only runs in Node.js where the module is already loaded.
  const { ClaudeCodeBackend } = require("./claude-code/index.js") as typeof import("./claude-code/index.js");
  const backend = new ClaudeCodeBackend();
  backends.set(backend.name, backend);
  _activeBackend = backend;
  return backend;
}

/** Reset the registry (used in tests). */
export function resetRegistry(): void {
  backends.clear();
  _activeBackend = null;
}
