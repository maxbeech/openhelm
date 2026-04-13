/**
 * Worker Scheduler — polls Supabase for due jobs every tick interval.
 * Multi-tenant: processes all users' due jobs in a single tick.
 * Respects per-user concurrency limits before enqueuing new runs.
 */

import { getSupabase } from "./supabase.js";
import { config } from "./config.js";
import { computeNextFireAt } from "./schedule.js";

export type OnRunReady = (runId: string, jobId: string, userId: string) => void;

/** Creates a run record for a due job and fires onRunReady. */
async function enqueueRun(job: Record<string, unknown>, onReady: OnRunReady): Promise<void> {
  const supabase = getSupabase();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabase.from("runs").insert({
    id: runId,
    user_id: job.user_id,
    job_id: job.id,
    status: "queued",
    trigger_source: "scheduled",
    started_at: null,
    finished_at: null,
    created_at: now,
  });

  if (error) {
    console.error(`[scheduler] failed to create run for job ${job.id}:`, error.message);
    return;
  }

  // Advance next_fire_at so the job doesn't fire again immediately
  const nextFireAt = computeNextFireAt(
    job.schedule_type as string,
    job.schedule_config as Record<string, unknown>,
  );
  await supabase
    .from("jobs")
    .update({ next_fire_at: nextFireAt ?? null, updated_at: now })
    .eq("id", job.id);

  console.error(`[scheduler] enqueued run ${runId} for job ${job.id} (user ${job.user_id})`);
  onReady(runId, job.id as string, job.user_id as string);
}

/** Single scheduler tick: find due jobs, enforce concurrency, enqueue runs. */
export async function tick(onRunReady: OnRunReady): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: dueJobs, error } = await supabase
    .from("jobs")
    .select("id, user_id, project_id, schedule_type, schedule_config, prompt")
    .lte("next_fire_at", now)
    .eq("is_enabled", true)
    .eq("is_archived", false);

  if (error) {
    console.error("[scheduler] tick query failed:", error.message);
    return;
  }
  if (!dueJobs || dueJobs.length === 0) return;

  console.error(`[scheduler] tick: ${dueJobs.length} due job(s)`);

  for (const job of dueJobs) {
    // Check concurrent run count for this user
    const { count } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id)
      .in("status", ["queued", "running"]);

    if ((count ?? 0) >= config.maxConcurrentRunsPerUser) {
      console.error(`[scheduler] user ${job.user_id} at concurrency limit, skipping job ${job.id}`);
      continue;
    }

    await enqueueRun(job, onRunReady);
  }
}

/** Mark any orphaned "running" runs as failed (called on worker startup). */
export async function recoverOrphanedRuns(): Promise<void> {
  const supabase = getSupabase();
  const { data: orphans, error } = await supabase
    .from("runs")
    .select("id")
    .eq("status", "running");

  if (error || !orphans || orphans.length === 0) return;

  const ids = orphans.map((r: { id: string }) => r.id);
  await supabase
    .from("runs")
    .update({
      status: "failed",
      summary: "Worker restarted while run was in progress.",
      finished_at: new Date().toISOString(),
    })
    .in("id", ids);

  console.error(`[scheduler] marked ${ids.length} orphaned run(s) as failed`);
}

/** Start the scheduler tick loop. Returns a cleanup function. */
export function startScheduler(onRunReady: OnRunReady): () => void {
  console.error(`[scheduler] starting; tick interval ${config.tickIntervalMs}ms`);

  const handle = setInterval(() => {
    tick(onRunReady).catch((err: Error) =>
      console.error("[scheduler] tick error:", err.message),
    );
  }, config.tickIntervalMs);

  // Run first tick immediately
  tick(onRunReady).catch((err: Error) =>
    console.error("[scheduler] initial tick error:", err.message),
  );

  return () => clearInterval(handle);
}
