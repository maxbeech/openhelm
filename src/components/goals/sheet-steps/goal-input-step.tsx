import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import * as api from "@/lib/api";
import { ErrorBanner } from "@/components/shared/error-banner";
import type { AssessmentResult } from "@openorchestra/shared";

interface GoalInputStepProps {
  goalText: string;
  onGoalTextChange: (text: string) => void;
  projectId: string;
  onAssessmentComplete: (result: AssessmentResult) => void;
}

export function GoalInputStep({
  goalText,
  onGoalTextChange,
  projectId,
  onAssessmentComplete,
}: GoalInputStepProps) {
  const [assessing, setAssessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!goalText.trim()) return;
    setAssessing(true);
    setError(null);
    try {
      const result = await api.assessGoal({
        projectId,
        goalDescription: goalText.trim(),
      });
      onAssessmentComplete(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Goal assessment failed",
      );
    } finally {
      setAssessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Textarea
          value={goalText}
          onChange={(e) => onGoalTextChange(e.target.value)}
          placeholder="Describe what you want to achieve..."
          rows={4}
          className="text-base"
          autoFocus
        />
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onRetry={handleContinue}
          onDismiss={() => setError(null)}
        />
      )}

      <Button
        onClick={handleContinue}
        disabled={!goalText.trim() || assessing}
        className="w-full"
      >
        {assessing ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Reviewing your goal...
          </>
        ) : (
          "Continue"
        )}
      </Button>
    </div>
  );
}
