/**
 * Centralized bridge that converts IPC events into inbox_events rows.
 * Called synchronously from emit() — must never throw or block.
 */

import { eq as drizzleEq, gte as drizzleGte, and as drizzleAnd, inArray as drizzleInArray } from "drizzle-orm";
import { createInboxEvent, resolveInboxEventBySource, upsertConversationThreadEvent, hasInboxEventForSource } from "../db/queries/inbox-events.js";
import { getConversation } from "../db/queries/conversations.js";
import { getSetting, setSetting } from "../db/queries/settings.js";
import { getDb } from "../db/init.js";
import { runs as runsTable, jobs as jobsTable, dashboardItems as dashboardItemsTable } from "../db/schema.js";
import { getBaseImportance, computeImportance } from "./inbox-scoring.js";
import { emit } from "./emitter.js";
import type { CreateInboxEventParams, InboxEvent } from "@openhelm/shared";

// Track if bridge is currently emitting to prevent infinite recursion
let emitting = false;

function emitInboxEvent(event: InboxEvent) {
  if (emitting) return;
  emitting = true;
  try {
    emit("inbox.eventCreated", event);
  } finally {
    emitting = false;
  }
}

function tryCreate(params: CreateInboxEventParams): void {
  try {
    const ev = createInboxEvent(params);
    emitInboxEvent(ev);
  } catch (err) {
    process.stderr.write(`[inbox-bridge] create failed: ${err}\n`);
  }
}

// ─── Event Handlers ───

type HandlerFn = (data: Record<string, unknown>) => void;

const EVENT_HANDLERS: Record<string, HandlerFn> = {
  "run.statusChanged": (data) => {
    const status = data.status as string;
    const runId = data.runId as string;
    const jobId = data.jobId as string;
    const jobName = (data.jobName as string) || "Job";
    const projectId = data.projectId as string;
    const triggerSource = data.triggerSource as string | undefined;
    const jobSource = data.source as string | undefined;

    if (status === "running") {
      const base = getBaseImportance("run.started");
      const importance = computeImportance(base, { triggerSource, jobSource });
      tryCreate({
        projectId,
        category: "run",
        eventType: "run.started",
        importance,
        title: `${jobName} started`,
        sourceId: runId,
        sourceType: "run",
        metadata: { runId, jobId, jobName, status, triggerSource },
      });
    } else if (["succeeded", "failed", "permanent_failure", "cancelled"].includes(status)) {
      const scoringKey = `run.completed.${status}`;
      const base = getBaseImportance(scoringKey);
      const importance = computeImportance(base, { triggerSource, jobSource });
      tryCreate({
        projectId,
        category: "run",
        eventType: `run.completed`,
        importance,
        title: `${jobName} ${status === "succeeded" ? "completed" : status === "permanent_failure" ? "permanently failed" : status}`,
        body: data.summary as string | undefined,
        sourceId: runId,
        sourceType: "run",
        metadata: { runId, jobId, jobName, status, triggerSource },
      });
    }
  },

  "dashboard.created": (data) => {
    const type = data.type as string;
    const scoringKey = `alert.${type}`;
    const base = getBaseImportance(scoringKey);
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "alert",
      eventType: `alert.${type}`,
      importance,
      title: data.title as string,
      body: data.message as string | undefined,
      sourceId: data.id as string,
      sourceType: "dashboard_item",
      metadata: { dashboardItemId: data.id, alertType: type, runId: data.runId, jobId: data.jobId },
    });
  },

  "dashboard.resolved": (data) => {
    const id = data.id as string;
    try {
      resolveInboxEventBySource("dashboard_item", id, (data.status === "dismissed" ? "dismissed" : "resolved"));
    } catch (err) {
      process.stderr.write(`[inbox-bridge] resolve sync failed: ${err}\n`);
    }
  },

  "chat.messageCreated": (data) => {
    const role = data.role as string;
    if (role !== "assistant") return;
    const hasPendingActions = Array.isArray(data.pendingActions) && data.pendingActions.length > 0;
    const hasToolCalls = Array.isArray(data.toolCalls) && data.toolCalls.length > 0;
    const conversationId = data.conversationId as string | undefined;
    const content = data.content as string;
    const projectId = data.projectId as string | null;

    // Check if this is an inbox channel conversation (direct inbox messages)
    // vs a regular side-panel conversation (should show as thread summary)
    const conv = conversationId ? getConversation(conversationId) : null;
    const isInboxChannel = conv?.channel === "inbox";

    if (isInboxChannel) {
      // Inbox-channel messages appear as individual events in the timeline
      const scoringKey = hasPendingActions ? "chat.assistant_message_with_actions" : "chat.assistant_message";
      const base = getBaseImportance(scoringKey);
      const importance = computeImportance(base, { hasToolCalls, hasPendingActions });
      tryCreate({
        projectId,
        category: "chat",
        eventType: "chat.assistant_message",
        importance,
        title: content.length > 80 ? content.slice(0, 80) + "..." : content,
        body: content,
        sourceId: data.id as string,
        sourceType: "message",
        conversationId,
        metadata: { messageId: data.id, conversationId, hasActions: hasPendingActions },
      });
    } else {
      // Side-panel conversations: upsert a single thread summary event per conversation
      const scoringKey = hasPendingActions ? "chat.assistant_message_with_actions" : "chat.assistant_message";
      const base = getBaseImportance(scoringKey);
      const importance = computeImportance(base, { hasToolCalls, hasPendingActions });
      try {
        const ev = upsertConversationThreadEvent({
          projectId,
          category: "chat",
          eventType: "chat.conversation_thread",
          importance,
          title: content.length > 80 ? content.slice(0, 80) + "..." : content,
          body: content,
          sourceId: conversationId ?? (data.id as string),
          sourceType: "message",
          conversationId,
          metadata: {
            messageId: data.id,
            conversationId,
            conversationTitle: conv?.title ?? null,
            hasActions: hasPendingActions,
          },
        });
        emitInboxEvent(ev);
      } catch (err) {
        process.stderr.write(`[inbox-bridge] conversation thread upsert failed: ${err}\n`);
      }
    }
  },

  "memory.created": (data) => {
    const base = getBaseImportance("memory.created");
    const importance = computeImportance(base, { memoryImportance: data.importance as number | undefined });
    tryCreate({
      projectId: data.projectId as string,
      category: "memory",
      eventType: "memory.created",
      importance,
      title: `Memory created: ${(data.content as string || "").slice(0, 60)}`,
      sourceId: data.id as string,
      sourceType: "memory",
      metadata: { memoryId: data.id, type: data.type, action: "created" },
    });
  },

  "memory.updated": (data) => {
    const base = getBaseImportance("memory.updated");
    const importance = computeImportance(base, { memoryImportance: data.importance as number | undefined });
    tryCreate({
      projectId: data.projectId as string,
      category: "memory",
      eventType: "memory.updated",
      importance,
      title: `Memory updated`,
      sourceId: data.id as string,
      sourceType: "memory",
      metadata: { memoryId: data.id, action: "updated" },
    });
  },

  "memory.deleted": (data) => {
    const base = getBaseImportance("memory.deleted");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "memory",
      eventType: "memory.deleted",
      importance,
      title: `Memory deleted`,
      sourceId: data.id as string,
      sourceType: "memory",
      metadata: { memoryId: data.id, action: "deleted" },
    });
  },

  "dataTable.created": (data) => {
    const base = getBaseImportance("data.dataTable.created");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "data",
      eventType: "data.table_created",
      importance,
      title: `Table created: ${data.name as string}`,
      sourceId: data.id as string,
      sourceType: "data_table",
      metadata: { tableId: data.id, tableName: data.name, action: "created" },
    });
  },

  "dataTable.deleted": (data) => {
    const base = getBaseImportance("data.dataTable.deleted");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "data",
      eventType: "data.table_deleted",
      importance,
      title: `Table deleted: ${data.name as string || "Unknown"}`,
      sourceId: data.id as string,
      sourceType: "data_table",
      metadata: { tableId: data.id, action: "deleted" },
    });
  },

  "dataTable.rowsInserted": (data) => {
    const count = (data.count as number) || 1;
    const base = getBaseImportance(count > 10 ? "data.dataTable.rows_bulk" : "data.dataTable.row_edit");
    const importance = computeImportance(base, { rowCount: count });
    tryCreate({
      projectId: data.projectId as string,
      category: "data",
      eventType: "data.rows_inserted",
      importance,
      title: `${count} row${count > 1 ? "s" : ""} added to ${data.tableName as string || "table"}`,
      sourceId: data.tableId as string,
      sourceType: "data_table",
      metadata: { tableId: data.tableId, tableName: data.tableName, count, action: "rows_inserted" },
    });
  },

  "dataTable.rowsDeleted": (data) => {
    const count = (data.count as number) || 1;
    const base = getBaseImportance("data.dataTable.row_edit");
    const importance = computeImportance(base, { rowCount: count });
    tryCreate({
      projectId: data.projectId as string,
      category: "data",
      eventType: "data.rows_deleted",
      importance,
      title: `${count} row${count > 1 ? "s" : ""} deleted from ${data.tableName as string || "table"}`,
      sourceId: data.tableId as string,
      sourceType: "data_table",
      metadata: { tableId: data.tableId, count, action: "rows_deleted" },
    });
  },

  "credential.created": (data) => {
    const base = getBaseImportance("credential.created");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: null,
      category: "credential",
      eventType: "credential.created",
      importance,
      title: `Credential created: ${data.name as string}`,
      sourceId: data.id as string,
      sourceType: "credential",
      metadata: { credentialId: data.id, name: data.name, action: "created" },
    });
  },

  "credential.updated": (data) => {
    const base = getBaseImportance("credential.updated");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: null,
      category: "credential",
      eventType: "credential.updated",
      importance,
      title: `Credential updated: ${data.name as string}`,
      sourceId: data.id as string,
      sourceType: "credential",
      metadata: { credentialId: data.id, name: data.name, action: "updated" },
    });
  },

  "credential.deleted": (data) => {
    const base = getBaseImportance("credential.deleted");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: null,
      category: "credential",
      eventType: "credential.deleted",
      importance,
      title: `Credential deleted: ${data.name as string || "Unknown"}`,
      sourceId: data.id as string,
      sourceType: "credential",
      metadata: { credentialId: data.id, action: "deleted" },
    });
  },

  "autopilot.proposalCreated": (data) => {
    const base = getBaseImportance("action.proposal_created");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "action",
      eventType: "action.proposal_created",
      importance,
      title: `Autopilot proposal: ${data.reason as string || "New system jobs"}`,
      sourceId: data.id as string,
      sourceType: "proposal",
      metadata: { proposalId: data.id, goalId: data.goalId },
    });
  },

  "captain.scanComplete": (data) => {
    const insights = data.insights as unknown[] | undefined;
    if (!insights || insights.length === 0) return;
    const base = getBaseImportance("insight.captain_insight");
    const importance = computeImportance(base, {});
    tryCreate({
      projectId: data.projectId as string,
      category: "insight",
      eventType: "insight.captain_scan",
      importance,
      title: `Captain scan: ${insights.length} insight${insights.length > 1 ? "s" : ""}`,
      sourceId: data.projectId as string,
      sourceType: "job",
      metadata: { insights },
    });
  },
};

/**
 * Backfill inbox_events from historic data on first startup.
 * Inserts events for runs and open dashboard items from the last 90 days.
 * Guarded by the `inbox_backfill_v2` settings key — runs only once per version.
 */
export function runBackfillIfNeeded(): void {
  try {
    // Use versioned key so we can re-run backfill after fixing bugs
    if (getSetting("inbox_backfill_v2")) return;

    const db = getDb();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Backfill all terminal runs from the last 90 days
    const historicRuns = db
      .select({
        id: runsTable.id,
        jobId: runsTable.jobId,
        status: runsTable.status,
        triggerSource: runsTable.triggerSource,
        summary: runsTable.summary,
        startedAt: runsTable.startedAt,
        finishedAt: runsTable.finishedAt,
        createdAt: runsTable.createdAt,
        jobName: jobsTable.name,
        projectId: jobsTable.projectId,
        jobSource: jobsTable.source,
      })
      .from(runsTable)
      .innerJoin(jobsTable, drizzleEq(runsTable.jobId, jobsTable.id))
      .where(
        drizzleAnd(
          drizzleGte(runsTable.createdAt, cutoff),
          drizzleInArray(runsTable.status, ["succeeded", "failed", "permanent_failure", "cancelled"]),
        ),
      )
      .limit(700)
      .all();

    for (const run of historicRuns) {
      // Skip if already backfilled (dedup)
      if (hasInboxEventForSource("run", run.id)) continue;

      const scoringKey = `run.completed.${run.status}`;
      const base = getBaseImportance(scoringKey);
      const importance = computeImportance(base, {
        triggerSource: run.triggerSource ?? undefined,
        jobSource: (run.jobSource as string | undefined) ?? undefined,
      });
      const label = run.status === "succeeded" ? "completed"
        : run.status === "permanent_failure" ? "permanently failed"
        : run.status === "failed" ? "failed"
        : run.status === "cancelled" ? "cancelled"
        : run.status;
      tryCreate({
        projectId: run.projectId ?? null,
        category: "run",
        eventType: "run.completed",
        importance,
        title: `${run.jobName} ${label}`,
        body: run.summary ?? undefined,
        sourceId: run.id,
        sourceType: "run",
        metadata: {
          runId: run.id,
          jobId: run.jobId,
          jobName: run.jobName,
          status: run.status,
          triggerSource: run.triggerSource,
        },
        eventAt: run.finishedAt ?? run.createdAt,
      });
    }

    // Backfill open dashboard items (active alerts)
    const openItems = db
      .select()
      .from(dashboardItemsTable)
      .where(drizzleEq(dashboardItemsTable.status, "open"))
      .limit(200)
      .all();

    for (const item of openItems) {
      if (hasInboxEventForSource("dashboard_item", item.id)) continue;
      const base = getBaseImportance(`alert.${item.type}`);
      const importance = computeImportance(base, {});
      tryCreate({
        projectId: item.projectId ?? null,
        category: "alert",
        eventType: `alert.${item.type}`,
        importance,
        title: item.title,
        body: item.message ?? undefined,
        sourceId: item.id,
        sourceType: "dashboard_item",
        metadata: {
          dashboardItemId: item.id,
          alertType: item.type,
          runId: (item as Record<string, unknown>).runId,
          jobId: (item as Record<string, unknown>).jobId,
        },
        eventAt: item.createdAt,
      });
    }

    setSetting("inbox_backfill_v2", new Date().toISOString());
    process.stderr.write(
      `[inbox-bridge] backfill complete: ${historicRuns.length} runs, ${openItems.length} alerts\n`,
    );
  } catch (err) {
    process.stderr.write(`[inbox-bridge] backfill error (non-fatal): ${err}\n`);
  }
}

/**
 * Called from emitter.ts after each emit().
 * Must never throw — errors are logged to stderr.
 */
export function onAgentEvent(event: string, data: unknown): void {
  // Skip our own events to prevent infinite recursion
  if (event.startsWith("inbox.")) return;
  const handler = EVENT_HANDLERS[event];
  if (!handler) return;
  try {
    handler(data as Record<string, unknown>);
  } catch (err) {
    process.stderr.write(`[inbox-bridge] ${event}: ${err}\n`);
  }
}
