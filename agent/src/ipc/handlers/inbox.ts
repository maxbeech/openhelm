import { registerHandler } from "../handler.js";
import {
  listInboxEvents,
  getInboxEvent,
  resolveInboxEvent,
  countInboxEvents,
  listImportancesInRange,
  createInboxEvent,
} from "../../db/queries/inbox-events.js";
import { resolveInboxEventBySource } from "../../db/queries/inbox-events.js";
import { resolveDashboardItem } from "../../db/queries/dashboard-items.js";
import {
  getOrCreateInboxConversation,
} from "../../db/queries/inbox-conversations.js";
import { listFutureJobOccurrences } from "../../db/queries/jobs.js";
import { handleChatMessage } from "../../chat/handler.js";
import { computeImportance, getBaseImportance } from "../inbox-scoring.js";
import { computeTierBoundaries } from "@openhelm/shared";
import { emit } from "../emitter.js";
import type {
  ListInboxEventsParams,
  ResolveInboxEventParams,
  SendInboxMessageParams,
  GetInboxTiersParams,
  ListFutureInboxEventsParams,
  InboxEvent,
} from "@openhelm/shared";

export function registerInboxHandlers() {
  registerHandler("inbox.list", (params) => {
    return listInboxEvents(params as ListInboxEventsParams);
  });

  registerHandler("inbox.get", (params) => {
    const { id } = params as { id: string };
    if (!id) throw new Error("id is required");
    return getInboxEvent(id);
  });

  registerHandler("inbox.resolve", (params) => {
    const p = params as ResolveInboxEventParams;
    if (!p?.id) throw new Error("id is required");
    if (!p?.status) throw new Error("status is required");

    const event = resolveInboxEvent(p.id, p.status);

    // Also resolve the linked dashboard item if this was an alert
    if (event.sourceType === "dashboard_item" && event.sourceId) {
      try {
        resolveDashboardItem(event.sourceId, p.status === "dismissed" ? "dismissed" : "resolved");
        emit("dashboard.resolved", { id: event.sourceId, status: p.status });
      } catch { /* dashboard item may already be resolved */ }
    }

    emit("inbox.eventResolved", event);
    return event;
  });

  registerHandler("inbox.sendMessage", async (params) => {
    const p = params as SendInboxMessageParams;
    if (!p?.content) throw new Error("content is required");

    const conv = getOrCreateInboxConversation(p.projectId);

    // Create inbox event for the user message
    const userEvent = createInboxEvent({
      projectId: p.projectId,
      category: "chat",
      eventType: "chat.user_message",
      importance: 10, // User messages are low importance (they know what they said)
      title: p.content.length > 80 ? p.content.slice(0, 80) + "..." : p.content,
      body: p.content,
      sourceType: "message",
      conversationId: conv.id,
      replyToEventId: p.replyToEventId,
    });
    emit("inbox.eventCreated", userEvent);

    // When replying to a specific event, prepend its content so the AI has
    // explicit context for references like "this" or "that" in the reply.
    let messageContent = p.content;
    if (p.replyToEventId) {
      const referencedEvent = getInboxEvent(p.replyToEventId);
      if (referencedEvent) {
        const refContent = referencedEvent.body || referencedEvent.title;
        messageContent = `[Replying to: "${refContent}"]\n\n${p.content}`;
      }
    }

    // Fire-and-forget: trigger the chat handler (AI will respond via chat.messageCreated → inbox bridge)
    setImmediate(() => {
      handleChatMessage(
        p.projectId,
        messageContent,
        p.context,
        undefined, // modelOverride
        undefined, // effort
        undefined, // permissionMode
        conv.id,   // conversationId
      ).catch((err) => {
        process.stderr.write(`[inbox] chat handler error: ${err}\n`);
      });
    });

    return { started: true, conversationId: conv.id };
  });

  registerHandler("inbox.count", (params) => {
    const p = params as { projectId?: string; status?: string } | undefined;
    return {
      count: countInboxEvents({
        projectId: p?.projectId,
        status: (p?.status as "active" | undefined) ?? "active",
      }),
    };
  });

  registerHandler("inbox.getTierBoundaries", (params) => {
    const p = params as GetInboxTiersParams;
    if (!p?.from || !p?.to) throw new Error("from and to are required");
    const importances = listImportancesInRange(p.projectId ?? null, p.from, p.to);
    return computeTierBoundaries(importances);
  });

  registerHandler("inbox.listFuture", (params) => {
    const p = params as ListFutureInboxEventsParams | undefined;
    const limit = p?.limit ?? 50;
    const after = p?.after ?? new Date().toISOString();
    const occurrences = listFutureJobOccurrences(p?.projectId ?? null, after, limit);

    // Return synthetic inbox events for future scheduled runs.
    // Future runs always get max importance so they appear in the highest tier —
    // users should always see what's coming up next.
    const now = new Date().toISOString();
    const futureEvents: InboxEvent[] = occurrences.map(({ job, fireAt }) => ({
      id: `future-${job.id}-${fireAt}`,
      projectId: job.projectId,
      category: "system" as const,
      eventType: "system.scheduled_run",
      importance: 100,
      title: `Scheduled: ${job.name}`,
      body: null,
      sourceId: job.id,
      sourceType: "job" as const,
      metadata: {
        jobId: job.id,
        jobName: job.name,
        scheduledFor: fireAt,
        scheduleType: job.scheduleType,
      },
      conversationId: null,
      replyToEventId: null,
      status: "active" as const,
      resolvedAt: null,
      eventAt: fireAt,
      createdAt: now,
    }));

    return futureEvents;
  });
}
