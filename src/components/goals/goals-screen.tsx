import { useState, useEffect } from "react";
import { Target, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores/app-store";
import { useGoalStore } from "@/stores/goal-store";
import { useJobStore } from "@/stores/job-store";
import { useRunStore } from "@/stores/run-store";
import { GoalCard } from "./goal-card";
import { GoalCreationSheet } from "./goal-creation-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/loading-skeleton";

const EXAMPLE_GOALS = [
  "Improve test coverage to 80%",
  "Fix all TypeScript strict mode errors",
  "Add API documentation for all endpoints",
];

export function GoalsScreen() {
  const { activeProjectId, setPage } = useAppStore();
  const { goals, loading, fetchGoals } = useGoalStore();
  const { jobs, fetchJobs } = useJobStore();
  const { runs, fetchRuns } = useRunStore();

  const [goalInput, setGoalInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (activeProjectId) {
      fetchGoals(activeProjectId);
      fetchJobs(activeProjectId);
      fetchRuns(activeProjectId);
    }
  }, [activeProjectId, fetchGoals, fetchJobs, fetchRuns]);

  const handleGoalSubmit = (text?: string) => {
    setGoalInput(text ?? goalInput);
    setSheetOpen(true);
  };

  const handleGoalClick = (goalId: string) => {
    setPage("jobs", { goalId });
  };

  if (!activeProjectId) return null;

  return (
    <div className="p-6">
      {/* Goal Input */}
      <div className="mb-8">
        <div className="relative">
          <Sparkles className="absolute top-3 left-3 size-5 text-primary" />
          <Input
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && goalInput.trim()) handleGoalSubmit();
            }}
            placeholder="What do you want to achieve?"
            className="h-12 border-primary/30 pl-10 text-base focus-visible:ring-primary/50"
          />
        </div>
        <div className="mt-2 flex gap-2">
          {EXAMPLE_GOALS.map((example) => (
            <button
              key={example}
              onClick={() => handleGoalSubmit(example)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Goals List */}
      {loading ? (
        <ListSkeleton count={3} />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Goals are the outcomes you want to achieve. Type your first goal above and OpenOrchestra will create a plan of Claude Code jobs to achieve it."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              jobs={jobs.filter((j) => j.goalId === goal.id)}
              runs={runs}
              onClick={() => handleGoalClick(goal.id)}
            />
          ))}
        </div>
      )}

      {/* Goal Creation Sheet */}
      <GoalCreationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialGoalText={goalInput}
        projectId={activeProjectId}
        onComplete={() => {
          setSheetOpen(false);
          setGoalInput("");
          fetchGoals(activeProjectId);
          fetchJobs(activeProjectId);
        }}
      />
    </div>
  );
}
