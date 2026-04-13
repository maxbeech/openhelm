/**
 * CloudOnboardingWizard — new user onboarding for cloud mode.
 *
 * Steps:
 *  0. Welcome — intro copy
 *  1. Plan selection — Starter / Growth / Scale (Stripe checkout)
 *  2. Create project — git repository URL
 *  3. Create job — first manual job prompt
 *  4. Complete — ready to run
 *
 * The wizard is shown when a cloud-mode user has no projects yet.
 * On completion it calls onComplete(projectId) so the parent can navigate.
 */

import { useState } from "react";
import { Rocket, GitBranch, Zap, Check, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { PlanSelector, type CloudPlan } from "./plan-selector";
import { useProjectStore } from "@/stores/project-store";
import { getSession, getWorkerUrl } from "@/lib/supabase-client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CloudOnboardingWizardProps {
  /** Called when the user completes onboarding with their first project. */
  onComplete: (projectId: string) => void;
}

type Step = "welcome" | "plan" | "project" | "job" | "complete";

const STEPS: Step[] = ["welcome", "plan", "project", "job", "complete"];

const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  plan: "Choose plan",
  project: "Create project",
  job: "First job",
  complete: "All set",
};

// ── Helper ─────────────────────────────────────────────────────────────────────

async function workerRpc<T>(method: string, params: unknown = {}): Promise<T> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${getWorkerUrl()}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ id: crypto.randomUUID(), method, params }),
  });

  if (!res.ok) throw new Error(`Worker RPC ${method} failed: HTTP ${res.status}`);
  const { result, error } = (await res.json()) as { id: string; result?: T; error?: { message: string } };
  if (error) throw new Error(error.message);
  return result as T;
}

// ── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        <Rocket className="size-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Welcome to OpenHelm Cloud</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Autonomous AI coding jobs that run in isolated sandboxes — no local install needed.
          Let's get you set up in four quick steps.
        </p>
      </div>
      <ul className="text-left space-y-2 text-sm text-muted-foreground w-full max-w-xs">
        {["Choose your plan", "Connect a git repository", "Define your first job", "Watch it run live"].map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-5 rounded-full bg-primary/20 text-primary text-xs font-medium flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            {item}
          </li>
        ))}
      </ul>
      <Button onClick={onNext} className="w-full max-w-xs">
        Get started <ChevronRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}

function PlanStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (plan: CloudPlan) => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await workerRpc<{ url: string }>("billing.createCheckout", {
        plan,
        // Return URL: after Stripe checkout, redirect back to the app
        successUrl: `${window.location.origin}?onboarding=plan-complete`,
        cancelUrl: window.location.href,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setLoading(false);
    }
  };

  // If the user is returned from a successful checkout, skip ahead
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("onboarding") === "plan-complete") {
    // Clean up URL and auto-advance
    window.history.replaceState({}, "", window.location.pathname);
    onNext();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Choose your plan</h2>
        <p className="text-sm text-muted-foreground mt-1">
          All plans include a 7-day free trial. Cancel anytime.
        </p>
      </div>

      <PlanSelector onSelect={handleSelect} loading={loading} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4 mr-1" /> Back
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={onNext}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function ProjectStep({
  onNext,
  onBack,
  onProjectCreated,
}: {
  onNext: () => void;
  onBack: () => void;
  onProjectCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createProject } = useProjectStore();

  const handleCreate = async () => {
    if (!name.trim() || !gitUrl.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        directoryPath: "",
        gitUrl: gitUrl.trim(),
        description: description.trim() || undefined,
      });
      onProjectCreated(project.id);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Create your first project</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Point OpenHelm at a git repository. The agent will clone it into a secure sandbox for each run.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ob-name">Project name</Label>
          <Input
            id="ob-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My API"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-git">Repository URL</Label>
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground shrink-0" />
            <Input
              id="ob-git"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
            />
          </div>
          <p className="text-xs text-muted-foreground">HTTPS URL — private repos require a credential added later.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-desc">
            Description <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="ob-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Brief description"
            className="max-h-28"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4 mr-1" /> Back
        </Button>
        <Button
          onClick={handleCreate}
          disabled={!name.trim() || !gitUrl.trim() || creating}
          className="ml-auto"
        >
          {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Create project <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function JobStep({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const session = await getSession();
      if (!session) throw new Error("Not authenticated");

      await workerRpc("jobs.create", {
        projectId,
        name: prompt.trim().slice(0, 60) + (prompt.length > 60 ? "…" : ""),
        description: "",
        prompt: prompt.trim(),
        scheduleType: "once",
        scheduleConfig: {},
        isEnabled: true,
      });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Define your first job</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Describe what you want the agent to do. Be specific — good prompts produce better results.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ob-prompt">Job prompt</Label>
        <Textarea
          id="ob-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="Add comprehensive unit tests to the authentication module. Target >80% coverage. Run the tests and confirm they pass."
          className="resize-none"
          autoFocus
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4 mr-1" /> Back
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onNext}>
            Skip
          </Button>
          <Button onClick={handleCreate} disabled={!prompt.trim() || creating}>
            {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Zap className="size-4 mr-2" />}
            Create job
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompleteStep({ onComplete, projectId }: { onComplete: (id: string) => void; projectId: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center">
      <div className="rounded-full bg-green-500/10 p-4">
        <Check className="size-8 text-green-500" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">You're all set!</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your project is ready. Trigger a manual run or set up a schedule — OpenHelm
          will execute your jobs in isolated cloud sandboxes and stream the output live.
        </p>
      </div>
      <Button onClick={() => onComplete(projectId)} className="w-full max-w-xs">
        Open project <ChevronRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────────

export function CloudOnboardingWizard({ onComplete }: CloudOnboardingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);

  const step = STEPS[stepIndex];
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <div className="mx-auto max-w-lg w-full space-y-6 p-6">
      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{STEP_LABELS[step]}</span>
          <span>Step {stepIndex + 1} of {STEPS.length}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Step content */}
      {step === "welcome" && <WelcomeStep onNext={next} />}

      {step === "plan" && <PlanStep onNext={next} onBack={back} />}

      {step === "project" && (
        <ProjectStep
          onNext={next}
          onBack={back}
          onProjectCreated={(id) => setProjectId(id)}
        />
      )}

      {step === "job" && (
        <JobStep
          projectId={projectId ?? ""}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "complete" && (
        <CompleteStep
          projectId={projectId ?? ""}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
