import { useState } from "react";
import { WelcomeStep } from "./steps/welcome-step";
import { UsageTypeStep } from "./steps/usage-type-step";
import { EmailStep } from "./steps/email-step";
import { ClaudeCodeStep } from "./steps/claude-code-step";
import { ProjectStep } from "./steps/project-step";
import { PaymentStep } from "./steps/payment-step";
import { CompleteStep } from "./steps/complete-step";
import { Progress } from "@/components/ui/progress";
import * as api from "@/lib/api";
import type { UsageType, EmployeeCount } from "@openhelm/shared";
import { needsPayment } from "@/lib/license-utils";

const STEP_LABELS = [
  "Welcome",
  "Email",
  "Usage",
  "Claude Code",
  "Project",
  "Payment",
  "Complete",
] as const;

interface OnboardingWizardProps {
  onComplete: (projectId: string) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [usageType, setUsageType] = useState<UsageType>("personal");
  const [employeeCount, setEmployeeCount] = useState<EmployeeCount>("1-3");
  const [userEmail, setUserEmail] = useState("");

  const requiresPayment = needsPayment(usageType, employeeCount);

  // Effective step count changes depending on whether payment is needed
  const totalSteps = requiresPayment ? STEP_LABELS.length : STEP_LABELS.length - 1;
  const progress = ((step + 1) / totalSteps) * 100;
  const currentLabel = STEP_LABELS[Math.min(step, STEP_LABELS.length - 1)];

  const next = () => setStep((s) => s + 1);

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
    // If payment needed, advance to payment step; otherwise skip to complete
    if (requiresPayment) {
      next(); // → payment
    } else {
      setStep(6); // → complete (index 6)
    }
  };

  const handleComplete = (autoUpdate: boolean) => {
    api
      .setSetting({ key: "auto_update_enabled", value: String(autoUpdate) })
      .catch(() => {})
      .finally(() => onComplete(projectId!));
  };

  return (
    <div className="no-select flex min-h-screen flex-col items-center justify-center bg-background p-8">
      {/* Progress (shown on steps 1–5) */}
      {step > 0 && step < STEP_LABELS.length - 1 && (
        <div className="fixed top-0 right-0 left-0 p-4">
          <div className="mx-auto max-w-md">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{currentLabel}</span>
              <span>
                {step + 1} of {totalSteps}
              </span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        </div>
      )}

      <div className="w-full max-w-md">
        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <EmailStep onNext={handleEmailNext} />}
        {step === 2 && <UsageTypeStep userEmail={userEmail} onBack={() => setStep(1)} onNext={handleUsageNext} />}
        {step === 3 && <ClaudeCodeStep onNext={next} />}
        {step === 4 && (
          <ProjectStep
            onNext={(id) => {
              setProjectId(id);
              handleProjectNext(id);
            }}
          />
        )}
        {step === 5 && requiresPayment && (
          <PaymentStep
            email={userEmail}
            employeeCount={employeeCount}
            onNext={next}
          />
        )}
        {step === 6 && <CompleteStep onComplete={handleComplete} />}
        {/* When payment not required, step 5 = complete */}
        {step === 5 && !requiresPayment && (
          <CompleteStep onComplete={handleComplete} />
        )}
      </div>
    </div>
  );
}
