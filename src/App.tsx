import { useEffect, useState } from "react";
import { agentClient } from "./lib/agent-client";
import * as api from "./lib/api";
import type { Project } from "@openorchestra/shared";

type PingResult = {
  message: string;
  timestamp: number;
};

type ConnectionStatus = "connecting" | "connected" | "error";

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    const onReady = () => setStatus("connected");
    window.addEventListener("agent:agent.ready", onReady);

    agentClient.start().catch((err) => {
      console.error("Failed to start agent client:", err);
      setStatus("error");
      setError(String(err));
    });

    return () => {
      window.removeEventListener("agent:agent.ready", onReady);
    };
  }, []);

  const sendPing = async () => {
    setPinging(true);
    setError(null);
    setPingResult(null);

    try {
      const result = await agentClient.request<PingResult>("ping");
      setPingResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPinging(false);
    }
  };

  const loadProjects = async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const result = await api.listProjects();
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProjects(false);
    }
  };

  return (
    <div className="no-select flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">
        <span style={{ color: "var(--primary)" }}>Open</span>Orchestra
      </h1>

      <div className="flex items-center gap-2 text-sm">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{
            backgroundColor:
              status === "connected"
                ? "#22c55e"
                : status === "connecting"
                  ? "#eab308"
                  : "#ef4444",
          }}
        />
        <span style={{ color: "var(--muted-foreground)" }}>
          Agent: {status}
        </span>
      </div>

      <div className="flex gap-3">
        <button
          onClick={sendPing}
          disabled={status !== "connected" || pinging}
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-foreground)",
          }}
        >
          {pinging ? "Pinging..." : "Send Ping"}
        </button>

        <button
          onClick={loadProjects}
          disabled={status !== "connected" || loadingProjects}
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--secondary)",
            color: "var(--secondary-foreground)",
          }}
        >
          {loadingProjects ? "Loading..." : "List Projects"}
        </button>
      </div>

      {pingResult && (
        <div
          className="rounded-md p-4 text-sm"
          style={{
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          <p>
            Response:{" "}
            <strong style={{ color: "#22c55e" }}>{pingResult.message}</strong>
          </p>
          <p style={{ color: "var(--muted-foreground)" }}>
            Timestamp: {new Date(pingResult.timestamp).toISOString()}
          </p>
        </div>
      )}

      {projects.length > 0 && (
        <div
          className="w-full max-w-md rounded-md p-4 text-sm"
          style={{
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          <p className="mb-2 font-medium">
            Projects ({projects.length})
          </p>
          {projects.map((p) => (
            <div
              key={p.id}
              className="mb-1 rounded p-2 text-xs"
              style={{ backgroundColor: "var(--background)" }}
            >
              <span className="font-medium">{p.name}</span>
              <span
                className="ml-2"
                style={{ color: "var(--muted-foreground)" }}
              >
                {p.directoryPath}
              </span>
            </div>
          ))}
        </div>
      )}

      {projects.length === 0 && !loadingProjects && status === "connected" && (
        <p
          className="text-xs"
          style={{ color: "var(--muted-foreground)" }}
        >
          No projects yet. Data will appear here once created.
        </p>
      )}

      {error && (
        <div
          className="rounded-md p-4 text-sm"
          style={{
            backgroundColor: "#1c0a0a",
            border: "1px solid #7f1d1d",
            color: "#fca5a5",
          }}
        >
          Error: {error}
        </div>
      )}

      <p
        className="mt-8 text-xs"
        style={{ color: "var(--muted-foreground)" }}
      >
        Phase 1 — Data Layer Debug Panel
      </p>
    </div>
  );
}
