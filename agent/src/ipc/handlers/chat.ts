import { registerHandler } from "../handler.js";
import { handleChatMessage } from "../../chat/handler.js";
import {
  handleActionApproval,
  handleActionRejection,
  handleApproveAll,
  handleRejectAll,
} from "../../chat/action-handler.js";
import {
  listMessagesForProject,
  listMessagesForConversation,
  listConversationsForProject,
  createConversation,
  renameConversation,
  deleteConversation,
  reorderConversations,
  clearConversation,
} from "../../db/queries/conversations.js";
import { emit } from "../emitter.js";
import type {
  SendChatMessageParams,
  ApproveChatActionParams,
  RejectChatActionParams,
  ApproveAllChatActionsParams,
  RejectAllChatActionsParams,
  ListChatMessagesParams,
  ClearChatParams,
  ListConversationsParams,
  CreateConversationParams,
  RenameConversationParams,
  DeleteConversationParams,
  ReorderConversationsParams,
} from "@openhelm/shared";

/** Normalise projectId: treat undefined and empty string as null ("All Projects"). */
function normaliseProjectId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

/**
 * Tracks which conversations have an in-flight handleChatMessage call.
 * Keyed by conversationId (or projectId fallback) so multiple threads
 * within the same project can process simultaneously.
 */
const activeChats = new Set<string>();
function chatKey(conversationId: string | undefined, projectId: string | null): string {
  return conversationId ?? projectId ?? "__all__";
}

export function registerChatHandlers() {
  registerHandler("chat.send", (params) => {
    const p = params as SendChatMessageParams;
    const projectId = normaliseProjectId(p?.projectId);
    const conversationId = p?.conversationId || undefined;
    if (!p?.content?.trim()) throw new Error("content is required");

    const key = chatKey(conversationId, projectId);
    if (activeChats.has(key)) {
      throw new Error("A message is already being processed. Please wait for the current response.");
    }

    activeChats.add(key);

    setImmediate(() => {
      handleChatMessage(projectId, p.content.trim(), p.context, p.model, p.modelEffort, p.permissionMode, conversationId)
        .catch((err) => {
          console.error("[chat] send failed:", err);
          emit("chat.error", {
            projectId,
            conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
          emit("chat.status", { status: "done", projectId, conversationId });
        })
        .finally(() => {
          activeChats.delete(key);
        });
    });

    return { started: true };
  });

  registerHandler("chat.approveAction", async (params) => {
    const p = params as ApproveChatActionParams;
    if (!p?.messageId) throw new Error("messageId is required");
    if (!p?.callId) throw new Error("callId is required");
    if (!p?.projectId) throw new Error("projectId is required");
    return handleActionApproval(p.messageId, p.callId, p.projectId);
  });

  registerHandler("chat.rejectAction", (params) => {
    const p = params as RejectChatActionParams;
    if (!p?.messageId) throw new Error("messageId is required");
    if (!p?.callId) throw new Error("callId is required");
    return handleActionRejection(p.messageId, p.callId);
  });

  registerHandler("chat.approveAll", async (params) => {
    const p = params as ApproveAllChatActionsParams;
    if (!p?.messageId) throw new Error("messageId is required");
    if (!p?.projectId) throw new Error("projectId is required");
    return handleApproveAll(p.messageId, p.projectId);
  });

  registerHandler("chat.rejectAll", (params) => {
    const p = params as RejectAllChatActionsParams;
    if (!p?.messageId) throw new Error("messageId is required");
    return handleRejectAll(p.messageId);
  });

  registerHandler("chat.listMessages", (params) => {
    const p = params as ListChatMessagesParams;
    if (p?.conversationId) {
      return listMessagesForConversation(p.conversationId, p?.limit, p?.beforeId);
    }
    const projectId = normaliseProjectId(p?.projectId);
    return listMessagesForProject(projectId, p?.limit, p?.beforeId);
  });

  registerHandler("chat.clear", (params) => {
    const p = params as ClearChatParams;
    const projectId = normaliseProjectId(p?.projectId);
    clearConversation(projectId, p?.conversationId || undefined);
    return { cleared: true };
  });

  // ─── Thread CRUD ───

  registerHandler("chat.listConversations", (params) => {
    const p = params as ListConversationsParams;
    const projectId = normaliseProjectId(p?.projectId);
    return listConversationsForProject(projectId);
  });

  registerHandler("chat.createConversation", (params) => {
    const p = params as CreateConversationParams;
    const projectId = normaliseProjectId(p?.projectId);
    return createConversation(projectId, p?.title);
  });

  registerHandler("chat.renameConversation", (params) => {
    const p = params as RenameConversationParams;
    if (!p?.conversationId) throw new Error("conversationId is required");
    if (!p?.title) throw new Error("title is required");
    return renameConversation(p.conversationId, p.title);
  });

  registerHandler("chat.deleteConversation", (params) => {
    const p = params as DeleteConversationParams;
    if (!p?.conversationId) throw new Error("conversationId is required");
    deleteConversation(p.conversationId);
    return { deleted: true };
  });

  registerHandler("chat.reorderConversations", (params) => {
    const p = params as ReorderConversationsParams;
    if (!p?.conversationIds?.length) throw new Error("conversationIds is required");
    reorderConversations(p.conversationIds);
    return { reordered: true };
  });
}
