/**
 * AgentBackend — pluggable interface for coding agent backends.
 *
 * All LLM/agent interactions in OpenHelm route through an AgentBackend.
 * Phase 1: ClaudeCodeBackend wraps the existing claude-code/ implementation.
 * Phase 2: GooseBackend provides the Cloud-tier hosted execution.
 */

// ─── Event Types ───

/**
 * Unified event emitted by any agent backend during execution.
 * Both onEvent and onStdout/onStderr callbacks fire for stdout/stderr content;
 * onEvent additionally carries structured data (tokens, session ID, system events).
 */
export interface AgentEvent {
  type: "system" | "assistant" | "user" | "tool_use" | "tool_result" | "result" | "rate_limit" | "error";
  /** Raw content — structure depends on type */
  data: unknown;
  /** Extracted fields (normalised across backends) */
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  rateLimitUtilization?: number;
  /** Extracted text for assistant events */
  text?: string;
  /** Tool name for tool_use events */
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
  costUsd?: number;
}

/**
 * System event data shapes emitted via AgentEvent.data when type === 'system'.
 * Used for backend-to-executor signalling (PID, interactive detection).
 */
export type SystemEventData =
  | { kind: "pid"; pid: number }
  | { kind: "interactive_detected"; reason: string; detectionType: string };

// ─── Run Types ───

/** Result returned when an agent run completes */
export interface AgentRunResult {
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  rateLimitUtilization: number | null;
}

/** Configuration for spawning a full agent run (job execution) */
export interface AgentRunConfig {
  prompt: string;
  workingDirectory: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  permissionMode?: string;
  maxBudgetUsd?: number;
  /** Appended to the system prompt (backend-specific support varies) */
  appendSystemPrompt?: string;
  mcpConfigPath?: string;
  resumeSessionId?: string;
  environmentVars?: Record<string, string>;
  timeoutMs?: number;
  /** Silence detection timeout (no output for this many ms → interactive detection) */
  silenceTimeoutMs?: number;
  abortSignal?: AbortSignal;
  /** Fired for structured events (token counts, system events, tool use) */
  onEvent?: (event: AgentEvent) => void;
  /** Fired for each stdout text chunk */
  onStdout?: (text: string) => void;
  /** Fired for each stderr line */
  onStderr?: (text: string) => void;
}

// ─── LLM Call Types ───

/** Configuration for a single-turn LLM call (planning, chat, summarisation) */
export interface LlmCallConfig {
  userMessage: string;
  systemPrompt?: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  disableTools?: boolean;
  allowedTools?: string;
  disallowedTools?: string;
  workingDirectory?: string;
  permissionMode?: string;
  jsonSchema?: object;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onTextChunk?: (chunk: string) => void;
  onToolUse?: (toolName: string) => void;
  preferRawText?: boolean;
  resumeSessionId?: string;
  onProgress?: (chunk: string) => void;
}

export interface LlmCallResult {
  text: string;
  sessionId: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

// ─── MCP / Backend Info ───

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface BackendInfo {
  name: string;
  version: string;
  path: string;
  healthy: boolean;
  authenticated: boolean;
}

// ─── Core Interface ───

/**
 * Pluggable backend interface — all coding agent / LLM interactions route through here.
 * Implementations: ClaudeCodeBackend (local), GooseBackend (cloud, Phase 2).
 */
export interface AgentBackend {
  readonly name: string;

  /** Check if this backend is installed and healthy */
  detect(): Promise<BackendInfo | null>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;

  /** Execute a full agent run (job execution) */
  run(config: AgentRunConfig): Promise<AgentRunResult>;

  /** Kill a running agent process by session ID */
  kill(sessionId: string): Promise<void>;

  /** Single-turn LLM call (planning, chat, summarisation) */
  llmCall(config: LlmCallConfig): Promise<LlmCallResult>;

  /** Build MCP config for this backend */
  buildMcpConfig(servers: McpServerConfig[]): unknown;

  /** Map model tier names to backend-specific model identifiers */
  resolveModel(tier: "planning" | "classification" | "chat" | "execution"): string;
}
