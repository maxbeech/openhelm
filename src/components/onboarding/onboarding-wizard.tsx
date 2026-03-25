import { useState } from "react";
import { WelcomeStep } from "./steps/welcome-step";
import { PermissionsStep } from "./steps/permissions-step";
import { UsageTypeStep } from "./steps/usage-type-step";
import { EmailStep } from "./steps/email-step";
import { ClaudeCodeStep } from "./steps/claude-code-step";
import { ProjectStep } from "./steps/project-step";
import { AutopilotStep } from "./steps/autopilot-step";
import { PaymentStep } from "./steps/payment-step";
import { CompleteStep } from "./steps/complete-step";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as api from "@/lib/api";
import type { UsageType, EmployeeCount } from "@openhelm/shared";
import { needsPayment } from "@/lib/license-utils";

const STEP_LABELS = [
  "Welcome",
  "Permissions",
  "Email",
  "Usage",
  "Claude Code",
  "Project",
  "Autopilot",
  "Payment",
  "Complete",
] as const;

interface OnboardingWizardProps {
  onComplete: (projectId: string) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [highestStep, setHighestStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [usageType, setUsageType] = useState<UsageType>("personal");
  const [employeeCount, setEmployeeCount] = useState<EmployeeCount>("1-3");
  const [userEmail, setUserEmail] = useState("");

  const requiresPayment = needsPayment(usageType, employeeCount);

  // Effective step count changes depending on whether payment is needed
  const totalSteps = requiresPayment ? STEP_LABELS.length : STEP_LABELS.length - 1;
  const progress = ((step + 1) / totalSteps) * 100;
  const currentLabel = STEP_LABELS[Math.min(step, STEP_LABELS.length - 1)];

  // Last "in-progress" step index (before the complete step)
  const lastMiddleStep = requiresPayment ? 7 : 6;
  const isComplete = requiresPayment ? step === 8 : step === 7 && !requiresPayment;

  const next = () =>
    setStep((s) => {
      const n = s + 1;
      setHighestStep((h) => Math.max(h, n));
      return n;
    });

  const goBack = () => {
    if (step <= 0) return;
    if (isComplete) {
      setStep(lastMiddleStep);
      return;
    }
    setStep((s) => s - 1);
  };

  const canGoBack = step > 0 && !isComplete;
  // Only allow forward if the user has already completed this step before
  const canGoForward = step > 0 && step < lastMiddleStep && step < highestStep;

  const handleUsageNext = (type: UsageType, count: EmployeeCount) => {
    setUsageType(type);
    setEmployeeCount(count);
    next();
  };

  const handleEmailNext = (email: string) => {
    setUserEmail(email);
    next();
  };

  const handleProjectNext = (id: string) => {
    setProjectId(id);
    next(); // → autopilot step
  };

  const handleAutopilotNext = () => {
    next(); // → payment (step 7) when required, or → complete (step 7) otherwise
  };

  const handleComplete = (autoUpdate: boolean) => {
    api
      .setSetting({ key: "auto_update_enabled", value: String(autoUpdate) })
      .catch(() => {})
      .finally(() => onComplete(projectId!));
  };

  return (
    <div
      data-tauri-drag-region
      className="no-select flex min-h-screen flex-col items-center justify-center bg-background p-8"
    >
      {/* Progress bar with navigation arrows (shown on steps 1–6) */}
      {step > 0 && step < STEP_LABELS.length - 1 && (
        <div data-tauri-drag-region className="fixed top-0 right-0 left-0 p-4">
          <div className="mx-auto max-w-md">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{currentLabel}</span>
              <div className="flex items-center gap-1">
                <span>
                  {step + 1} of {totalSteps}
                </span>
                <button
                  type="button"
                  onClick={goBack}
                  disabled={!canGoBack}
                  className="ml-1 rounded p-0.5 text-orange-500 transition-colors hover:text-orange-600 disabled:opacity-30 disabled:hover:text-orange-500"
                  aria-label="Go back"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canGoForward}
                  className="rounded p-0.5 text-orange-500 transition-colors hover:text-orange-600 disabled:opacity-30 disabled:hover:text-orange-500"
                  aria-label="Go forward"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        </div>
      )}

      <div className="w-full max-w-md">
        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <PermissionsStep onNext={next} />}
        {step === 2 && <EmailStep onNext={handleEmailNext} />}
        {step === 3 && <UsageTypeStep userEmail={userEmail} onBack={() => setStep(2)} onNext={handleUsageNext} />}
        {step === 4 && <ClaudeCodeStep onNext={next} />}
        {step === 5 && (
          <ProjectStep
            onNext={(id) => {
              setProjectId(id);
              handleProjectNext(id);
            }}
          />
        )}
        {step === 6 && <AutopilotStep onNext={handleAutopilotNext} />}
        {step === 7 && requiresPayment && (
          <PaymentStep
            email={userEmail}
            employeeCount={employeeCount}
            onNext={next}
          />
        )}
        {step === 8 && <CompleteStep onComplete={handleComplete} />}
        {/* When payment not required, step 7 = complete */}
        {step === 7 && !requiresPayment && (
          <CompleteStep onComplete={handleComplete} />
        )}
      </div>
    </div>
  );
}
