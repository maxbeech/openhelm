/**
 * Stream Relay — bridges E2B sandbox stdout to Supabase Realtime Broadcast.
 *
 * Real-time path: sandbox stdout → parse → Broadcast on `run:{runId}`
 * Persistence path: buffer log lines → batch INSERT to run_logs every 5s / 50 lines
 */

import { getSupabase } from "./supabase.js";

interface LogLine {
  run_id: string;
  sequence: number;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
}

export interface StreamRelay {
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
  flush: () => Promise<void>;
  cleanup: () => void;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 50;

export function createStreamRelay(runId: string): StreamRelay {
  const supabase = getSupabase();
  const channel = supabase.channel(`run:${runId}`);

  // Subscribe channel — errors are non-fatal; streaming still works
  channel.subscribe((status: string) => {
    if (status === "SUBSCRIBED") {
      console.error(`[stream-relay] channel run:${runId} subscribed`);
    } else if (status === "CHANNEL_ERROR") {
      console.error(`[stream-relay] channel error for run:${runId}`);
    }
  });

  const buffer: LogLine[] = [];
  let sequence = 0;

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    const { error } = await supabase.from("run_logs").insert(batch);
    if (error) {
      console.error(`[stream-relay] failed to persist logs for run ${runId}:`, error.message);
    }
  }

  const flushTimer = setInterval(() => {
    flushBuffer().catch((e: Error) => console.error("[stream-relay] flush error:", e.message));
  }, FLUSH_INTERVAL_MS);

  function handleLine(text: string, stream: "stdout" | "stderr"): void {
    const seq = sequence++;
    const line: LogLine = {
      run_id: runId,
      sequence: seq,
      stream,
      text,
      timestamp: new Date().toISOString(),
    };

    buffer.push(line);

    // Broadcast in real-time (fire-and-forget)
    channel.send({
      type: "broadcast",
      event: "log",
      payload: { sequence: seq, stream, text, timestamp: line.timestamp },
    }).catch(() => { /* non-fatal */ });

    if (buffer.length >= FLUSH_BATCH_SIZE) {
      flushBuffer().catch((e: Error) => console.error("[stream-relay] batch flush error:", e.message));
    }
  }

  return {
    onStdout: (line) => handleLine(line, "stdout"),
    onStderr: (line) => handleLine(line, "stderr"),
    flush: flushBuffer,
    cleanup: () => {
      clearInterval(flushTimer);
      flushBuffer().catch(() => { /* best-effort */ });
      supabase.removeChannel(channel);
    },
  };
}
