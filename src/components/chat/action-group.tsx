import { useState } from "react";
import { Check, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat-store";
import { ActionCard } from "./action-card";
import type { PendingAction, ChatContext } from "@openorchestra/shared";

interface ActionGroupProps {
  messageId: string;
  actions: PendingAction[];
  projectId: string;
}

export function ActionGroup({ messageId, actions, projectId }: ActionGroupProps) {
  const { approveAll, rejectAll, sendMessage } = useChatStore();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [approving, setApproving] = useState(false);
  const [submittingChange, setSubmittingChange] = useState(false);

  const hasPending = actions.some((a) => a.status === "pending");

  const handleApproveAll = async () => {
    setApproving(true);
    try {
      await approveAll(messageId, projectId);
    } catch {
      // error is set in store
    } finally {
      setApproving(false);
    }
  };

  const handleRequestChange = async () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmittingChange(true);
    try {
      await rejectAll(messageId);
      const context: ChatContext = {};
      await sendMessage(projectId, trimmed, context);
      setShowFeedback(false);
      setFeedback("");
    } catch {
      // error is set in store
    } finally {
      setSubmittingChange(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {actions.map((action) => (
        <ActionCard key={action.callId} action={action} />
      ))}

      {hasPending && !showFeedback && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={() => setShowFeedback(true)}
            disabled={approving}
          >
            <MessageSquare className="size-3" />
            Request Change
          </Button>
          <Button
            size="sm"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={handleApproveAll}
            disabled={approving}
          >
            {approving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            {approving ? "Approving..." : `Approve All (${actions.filter((a) => a.status === "pending").length})`}
          </Button>
        </div>
      )}

      {hasPending && showFeedback && (
        <div className="space-y-2 pt-1">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what you'd like changed..."
            rows={2}
            className="min-h-[60px] text-xs"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-xs"
              onClick={() => {
                setShowFeedback(false);
                setFeedback("");
              }}
              disabled={submittingChange}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 gap-1 text-xs"
              onClick={handleRequestChange}
              disabled={!feedback.trim() || submittingChange}
            >
              {submittingChange ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <MessageSquare className="size-3" />
              )}
              {submittingChange ? "Sending..." : "Send Feedback"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
