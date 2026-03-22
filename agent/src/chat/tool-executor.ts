/**
 * Executes chat tool calls against the local database and scheduler.
 * Read tools run immediately; write tools run only after user confirmation.
 */

import { getGoal, listGoals, updateGoal, createGoal } from "../db/queries/goals.js";
import { getJob, listJobs, createJob, updateJob, archiveJob } from "../db/queries/jobs.js";
import { listRuns, createRun } from "../db/queries/runs.js";
import { listRunLogs } from "../db/queries/run-logs.js";
import { listMemories, createMemory, updateMemory, deleteMemory } from "../db/queries/memories.js";
import { generateEmbedding } from "../memory/embeddings.js";
import { jobQueue } from "../scheduler/queue.js";
import { executor } from "../executor/index.js";
import { emit } from "../ipc/emitter.js";
import type { ChatToolCall, ScheduleConfig } from "@openhelm/shared";

export interface ToolExecutionResult {
  callId: string;
  tool: string;
  result: unknown;
  error?: string;
}

function ok(call: ChatToolCall, result: unknown): ToolExecutionResult {
  return { callId: call.id, tool: call.tool, result };
}

function fail(call: ChatToolCall, error: string): ToolExecutionResult {
  console.error(`[chat:tool] ${call.tool} failed: ${error}`);
  return { callId: call.id, tool: call.tool, result: null, error };
}

/** Execute a read (non-mutating) tool immediately. */
export function executeReadTool(call: ChatToolCall, projectId: string): ToolExecutionResult {
  const a = call.args;
  try {
    switch (call.tool) {
      case "list_goals":
        return ok(call, listGoals({ projectId, status: a.status as any }));

      case "list_jobs":
        return ok(call, listJobs({ projectId, goalId: a.goalId as string | undefined }));

      case "list_runs":
        return ok(call, listRuns({
          projectId,
          jobId: a.jobId as string | undefined,
          limit: (a.limit as number | undefined) ?? 10,
        }));

      case "get_run_logs": {
        if (!a.runId) return fail(call, "runId is required");
        return ok(call, listRunLogs({ runId: a.runId as string }));
      }

      case "get_goal": {
        if (!a.goalId) return fail(call, "goalId is required");
        const goal = getGoal(a.goalId as string);
        return goal ? ok(call, goal) : fail(call, `Goal not found: ${a.goalId}`);
      }

      case "get_job": {
        if (!a.jobId) return fail(call, "jobId is required");
        const job = getJob(a.jobId as string);
        return job ? ok(call, job) : fail(call, `Job not found: ${a.jobId}`);
      }

      case "list_memories":
        return ok(call, listMemories({
          projectId,
          type: a.type as any,
          tag: a.tag as string | undefined,
          isArchived: false,
        }));

      default:
        return fail(call, `Unknown read tool: ${call.tool}`);
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}

/** Execute a write (mutating) tool after user confirmation. */
export async function executeWriteTool(call: ChatToolCall, projectId: string): Promise<ToolExecutionResult> {
  const a = call.args;
  try {
    switch (call.tool) {
      case "create_goal":
        return ok(call, createGoal({
          projectId,
          name: a.name as string,
          description: a.description as string | undefined,
        }));

      case "create_job": {
        const scheduleType = a.scheduleType as string;
        let scheduleConfig: ScheduleConfig;
        if (scheduleType === "once") {
          scheduleConfig = { fireAt: new Date(Date.now() + 10_000).toISOString() };
        } else if (scheduleType === "interval") {
          const mins = (a.intervalMinutes as number) ?? 60;
          // Store in canonical { amount, unit } format
          if (mins >= 1440 && mins % 1440 === 0) {
            scheduleConfig = { amount: mins / 1440, unit: "days" };
          } else if (mins >= 60 && mins % 60 === 0) {
            scheduleConfig = { amount: mins / 60, unit: "hours" };
          } else {
            scheduleConfig = { amount: mins, unit: "minutes" };
          }
        } else {
          scheduleConfig = { expression: (a.cronExpression as string) ?? "0 9 * * 1" };
        }
        return ok(call, createJob({
          projectId,
          goalId: a.goalId as string | undefined,
          name: a.name as string,
          prompt: a.prompt as string,
          scheduleType: scheduleType as any,
          scheduleConfig,
          workingDirectory: a.workingDirectory as string | undefined,
        }));
      }

      case "update_goal":
        return ok(call, updateGoal({
          id: a.goalId as string,
          name: a.name as string | undefined,
          description: a.description as string | undefined,
          status: a.status as any,
        }));

      case "update_job":
        return ok(call, updateJob({
          id: a.jobId as string,
          name: a.name as string | undefined,
          prompt: a.prompt as string | undefined,
          isEnabled: a.isEnabled as boolean | undefined,
        }));

      case "archive_goal":
        return ok(call, updateGoal({ id: a.goalId as string, status: "archived" }));

      case "archive_job":
        return ok(call, archiveJob(a.jobId as string));

      case "save_memory": {
        if (!a.content) return fail(call, "content is required");
        const tags = a.tags ? (a.tags as string).split(",").map((t: string) => t.trim()) : [];
        let embedding: number[] | undefined;
        try { embedding = await generateEmbedding(a.content as string); } catch { /* skip */ }
        const mem = createMemory({
          projectId,
          type: (a.type as any) ?? "semantic",
          content: a.content as string,
          sourceType: "chat",
          importance: (a.importance as number) ?? 5,
          tags,
        }, embedding);
        emit("memory.created", mem);
        return ok(call, mem);
      }

      case "update_memory": {
        if (!a.memoryId) return fail(call, "memoryId is required");
        let embedding: number[] | undefined;
        if (a.content) {
          try { embedding = await generateEmbedding(a.content as string); } catch { /* skip */ }
        }
        const mem = updateMemory({
          id: a.memoryId as string,
          content: a.content as string | undefined,
          importance: a.importance as number | undefined,
        }, embedding);
        emit("memory.updated", mem);
        return ok(call, mem);
      }

      case "forget_memory": {
        if (!a.memoryId) return fail(call, "memoryId is required");
        const deleted = deleteMemory(a.memoryId as string);
        if (deleted) emit("memory.deleted", { id: a.memoryId });
        return ok(call, { deleted });
      }

      case "trigger_run": {
        const jobId = a.jobId as string;
        const fireAt = a.fire_at as string | undefined;
        const job = getJob(jobId);
        if (!job) return fail(call, `Job not found: ${jobId}`);

        // Deferred path: fire_at is set and in the future
        if (fireAt && new Date(fireAt) > new Date()) {
          const run = createRun({
            jobId,
            triggerSource: "manual",
            status: "deferred",
            scheduledFor: fireAt,
          });
          emit("run.created", { runId: run.id, jobId });
          emit("run.statusChanged", { runId: run.id, status: "deferred", jobId });
          return ok(call, run);
        }

        // Immediate path
        const run = createRun({ jobId, triggerSource: "manual" });
        jobQueue.enqueue({ runId: run.id, jobId, priority: 0, enqueuedAt: Date.now() });
        emit("run.created", { runId: run.id, jobId });
        emit("run.statusChanged", { runId: run.id, status: "queued", jobId });
        executor.processNext();
        return ok(call, run);
      }

      default:
        return fail(call, `Unknown write tool: ${call.tool}`);
    }
  } catch (err) {
    return fail(call, err instanceof Error ? err.message : String(err));
  }
}
