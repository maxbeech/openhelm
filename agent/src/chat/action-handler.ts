/**
 * Action approval/rejection handlers — manages pending write-tool actions
 * proposed by the chat LLM. Extracted from handler.ts for file size.
 */

import {
  getMessage,
  updateMessagePendingActions,
  getProjectIdForMessage,
} from "../db/queries/conversations.js";
import { executeWriteTool } from "./tool-executor.js";
import { emit } from "../ipc/emitter.js";
import { generateAndHandleSystemJobs } from "../autopilot/index.js";
import type { ChatMessage, ChatToolCall } from "@openhelm/shared";

export async function handleActionApproval(
  messageId: string,
  callId: string,
  projectId: string,
): Promise<ChatMessage> {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const action = pending.find((a) => a.callId === callId);
  if (!action) throw new Error(`Action not found: ${callId}`);
  if (action.status !== "pending") throw new Error(`Action already resolved: ${callId}`);

  // Execute the write tool
  const call: ChatToolCall = { id: callId, tool: action.tool, args: action.args };
  const result = await executeWriteTool(call, projectId);

  // Mark approved
  let updated = pending.map((a) => a.callId === callId ? { ...a, status: "approved" as const } : a);

  // When a goal is created, link its sibling create_job actions to the real goal ID.
  // Jobs are linked by ordering: jobs after this goal but before the next goal belong to it.
  if (action.tool === "create_goal" && result.result && !result.error) {
    const createdGoalId = (result.result as { id: string }).id;
    const thisIdx = updated.findIndex((a) => a.callId === callId);
    // Find the next create_goal action after this one (if any)
    const nextGoalIdx = updated.findIndex((a, i) => i > thisIdx && a.tool === "create_goal");
    const endIdx = nextGoalIdx === -1 ? updated.length : nextGoalIdx;

    // Tools whose goalId sentinel "pending" should be resolved to the real goal ID
    const linkableTools = ["create_job", "create_target", "create_visualization"];
    updated = updated.map((a, i) => {
      // Only update actions between this goal and the next goal
      if (i > thisIdx && i < endIdx && linkableTools.includes(a.tool) && a.status === "pending" && a.args.goalId === "pending") {
        return { ...a, args: { ...a.args, goalId: createdGoalId } };
      }
      return a;
    });

    // Trigger autopilot here — createdGoalId is the real DB ID from the execution
    // result, which was never available in triggerAutopilotForCreatedGoals.
    generateAndHandleSystemJobs(createdGoalId, projectId).catch((err) =>
      console.error("[chat] autopilot generation failed:", err),
    );
  }

  const updatedMsg = updateMessagePendingActions(messageId, updated);

  emit("chat.actionResolved", { messageId, callId, status: "approved", projectId, conversationId: msg.conversationId });
  return updatedMsg;
}

export function handleActionRejection(messageId: string, callId: string): ChatMessage {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);
  const projectId = getProjectIdForMessage(messageId);

  const pending = msg.pendingActions ?? [];
  const action = pending.find((a) => a.callId === callId);
  if (!action) throw new Error(`Action not found: ${callId}`);
  if (action.status !== "pending") throw new Error(`Action already resolved: ${callId}`);

  const updated = pending.map((a) => a.callId === callId ? { ...a, status: "rejected" as const } : a);
  const updatedMsg = updateMessagePendingActions(messageId, updated);

  emit("chat.actionResolved", { messageId, callId, status: "rejected", projectId, conversationId: msg.conversationId });
  return updatedMsg;
}

/**
 * Approve all pending actions on a message in order.
 * Goal actions are processed first so FK linking works for sibling jobs.
 */
export async function handleApproveAll(
  messageId: string,
  projectId: string,
): Promise<ChatMessage> {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const pending = msg.pendingActions ?? [];
  const pendingCallIds = pending
    .filter((a) => a.status === "pending")
    // Sort so create_goal runs first, then data tables, then everything else.
    // This ensures FK-linking logic can resolve the real goal ID for sibling
    // jobs, targets, and visualizations that reference goalId: "pending".
    .sort((a, b) => {
      const priority = (t: string) => t === "create_goal" ? 0 : t === "create_data_table" ? 1 : 2;
      return priority(a.tool) - priority(b.tool);
    })
    .map((a) => a.callId);

  if (pendingCallIds.length === 0) throw new Error("No pending actions to approve");

  // Process sequentially — goal before jobs for FK linking
  let current: ChatMessage = msg;
  for (const callId of pendingCallIds) {
    current = await handleActionApproval(messageId, callId, projectId);
  }

  return current;
}

/**
 * Reject all pending actions on a message at once.
 */
export function handleRejectAll(messageId: string): ChatMessage {
  const msg = getMessage(messageId);
  if (!msg) throw new Error(`Message not found: ${messageId}`);
  const projectId = getProjectIdForMessage(messageId);

  const pending = msg.pendingActions ?? [];
  const pendingActions = pending.filter((a) => a.status === "pending");
  if (pendingActions.length === 0) throw new Error("No pending actions to reject");

  const updated = pending.map((a) =>
    a.status === "pending" ? { ...a, status: "rejected" as const } : a,
  );
  const updatedMsg = updateMessagePendingActions(messageId, updated);

  for (const a of pendingActions) {
    emit("chat.actionResolved", { messageId, callId: a.callId, status: "rejected", projectId, conversationId: msg.conversationId });
  }

  return updatedMsg;
}
