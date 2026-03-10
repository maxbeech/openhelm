import { registerHandler } from "../handler.js";
import {
  handleChatMessage,
  handleActionApproval,
  handleActionRejection,
  handleApproveAll,
  handleRejectAll,
} from "../../chat/handler.js";
import { listMessagesForProject, clearConversation } from "../../db/queries/conversations.js";
import type {
  SendChatMessageParams,
  ApproveChatActionParams,
  RejectChatActionParams,
  ApproveAllChatActionsParams,
  RejectAllChatActionsParams,
  ListChatMessagesParams,
  ClearChatParams,
} from "@openorchestra/shared";

export function registerChatHandlers() {
  registerHandler("chat.send", async (params) => {
    const p = params as SendChatMessageParams;
    if (!p?.projectId) throw new Error("projectId is required");
    if (!p?.content?.trim()) throw new Error("content is required");
    return handleChatMessage(p.projectId, p.content.trim(), p.context);
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
    if (!p?.projectId) throw new Error("projectId is required");
    return listMessagesForProject(p.projectId, p.limit, p.beforeId);
  });

  registerHandler("chat.clear", (params) => {
    const p = params as ClearChatParams;
    if (!p?.projectId) throw new Error("projectId is required");
    clearConversation(p.projectId);
    return { cleared: true };
  });
}
