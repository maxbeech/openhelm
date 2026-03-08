import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import * as api from "@/lib/api";
import { ErrorBanner } from "@/components/shared/error-banner";
import type { ClarifyingQuestion, GeneratedPlan } from "@openorchestra/shared";
import { cn } from "@/lib/utils";

interface ClarificationStepProps {
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  onAnswersChange: (answers: Record<string, string>) => void;
  projectId: string;
  goalText: string;
  onPlanGenerated: (plan: GeneratedPlan) => void;
}

export function ClarificationStep({
  questions,
  answers,
  onAnswersChange,
  projectId,
  goalText,
  onPlanGenerated,
}: ClarificationStepProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<string, boolean>>({});

  const allAnswered = questions.every((q) => answers[q.question]?.trim());

  const selectAnswer = (question: string, answer: string) => {
    if (answer === "__custom__") {
      setCustomInputs((c) => ({ ...c, [question]: true }));
      onAnswersChange({ ...answers, [question]: "" });
    } else {
      setCustomInputs((c) => ({ ...c, [question]: false }));
      onAnswersChange({ ...answers, [question]: answer });
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const plan = await api.generatePlan({
        projectId,
        goalDescription: goalText,
        clarificationAnswers: answers,
      });
      onPlanGenerated(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        A few questions to generate a better plan:
      </p>

      {questions.map((q) => (
        <div key={q.question} className="space-y-2">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => (
              <button
                key={opt}
                onClick={() => selectAnswer(q.question, opt)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  answers[q.question] === opt && !customInputs[q.question]
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50",
                )}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={() => selectAnswer(q.question, "__custom__")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                customInputs[q.question]
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50",
              )}
            >
              Something else
            </button>
          </div>
          {customInputs[q.question] && (
            <Input
              value={answers[q.question] ?? ""}
              onChange={(e) =>
                onAnswersChange({ ...answers, [q.question]: e.target.value })
              }
              placeholder="Type your answer..."
              className="mt-1"
              autoFocus
            />
          )}
        </div>
      ))}

      {error && (
        <ErrorBanner
          message={error}
          onRetry={handleGenerate}
          onDismiss={() => setError(null)}
        />
      )}

      <Button
        onClick={handleGenerate}
        disabled={!allAnswered || generating}
        className="w-full"
      >
        {generating ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Generating plan...
          </>
        ) : (
          "Generate plan"
        )}
      </Button>
    </div>
  );
}
