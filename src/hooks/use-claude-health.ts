import { useEffect, useState, useCallback } from "react";
import * as api from "@/lib/api";
import type { DashboardItem } from "@openhelm/shared";

export interface ClaudeHealthState {
  checked: boolean;
  healthy: boolean;
  error: string | null;
  dismiss: () => void;
  recheck: () => void;
}

/**
 * Runs a Claude Code health check on mount and exposes the result.
 * The check verifies the CLI is authenticated and can actually run.
 * Also listens for auth_required dashboard events to auto-recheck.
 */
export function useClaudeHealth(): ClaudeHealthState {
  const [checked, setChecked] = useState(false);
  const [healthy, setHealthy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const runCheck = useCallback(async () => {
    try {
      const result = await api.checkClaudeCodeHealth();
      setHealthy(result.healthy);
      setError(result.healthy ? null : (result.error ?? "Claude Code is not responding."));
      setDismissed(false);
    } catch {
      // Agent not reachable — don't show a misleading banner
      setHealthy(true);
      setError(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // Auto-recheck when an auth_required dashboard alert is created
  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<DashboardItem>).detail;
      if (item?.type === "auth_required") {
        runCheck();
      }
    };
    window.addEventListener("agent:dashboard.created", handler);
    return () => window.removeEventListener("agent:dashboard.created", handler);
  }, [runCheck]);

  return {
    checked,
    healthy: healthy || dismissed,
    error: dismissed ? null : error,
    dismiss: () => setDismissed(true),
    recheck: runCheck,
  };
}
