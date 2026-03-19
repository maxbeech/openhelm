import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, GraduationCap, Briefcase, AlertTriangle } from "lucide-react";
import type { UsageType, EmployeeCount } from "@openhelm/shared";
import * as api from "@/lib/api";
import { isCommercialEmail } from "@/lib/email-validation";

const EMPLOYEE_OPTIONS: { value: EmployeeCount; label: string }[] = [
  { value: "1-3", label: "1–3 team members" },
  { value: "4-10", label: "4–10 team members" },
  { value: "11-50", label: "11–50 team members" },
  { value: "51-200", label: "51–200 team members" },
  { value: "200+", label: "200+ team members" },
];

interface UsageTypeStepProps {
  userEmail: string;
  onBack: () => void;
  onNext: (usageType: UsageType, employeeCount: EmployeeCount) => void;
}

export function UsageTypeStep({ userEmail, onBack, onNext }: UsageTypeStepProps) {
  const [selected, setSelected] = useState<UsageType | null>(null);
  const [employeeCount, setEmployeeCount] = useState<EmployeeCount>("1-3");
  const [saving, setSaving] = useState(false);

  const hasMismatch =
    selected !== null &&
    (selected === "personal" || selected === "education") &&
    isCommercialEmail(userEmail);

  const handleContinue = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.setSetting({ key: "usage_type", value: selected });
      if (selected === "business") {
        await api.setSetting({ key: "employee_count", value: employeeCount });
      }
      onNext(selected, selected === "business" ? employeeCount : "1-3");
    } catch {
      // Settings save is best-effort — continue anyway
      onNext(selected, selected === "business" ? employeeCount : "1-3");
    } finally {
      setSaving(false);
    }
  };

  const options: { value: UsageType; label: string; description: string; icon: React.ReactNode }[] = [
    {
      value: "personal",
      label: "Personal use",
      description: "For individual projects and personal work",
      icon: <User className="size-5" />,
    },
    {
      value: "education",
      label: "Educational use",
      description: "For students, educators, and academic institutions",
      icon: <GraduationCap className="size-5" />,
    },
    {
      value: "business",
      label: "Business use",
      description: "For commercial projects and organisations",
      icon: <Briefcase className="size-5" />,
    },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-2xl font-semibold">How will you use OpenHelm?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This determines your license tier. Most users qualify for free Community access.
      </p>

      <div className="mt-6 w-full max-w-sm space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSelected(opt.value)}
            className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
              selected === opt.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <span className={`mt-0.5 shrink-0 ${selected === opt.value ? "text-primary" : "text-muted-foreground"}`}>
              {opt.icon}
            </span>
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>

      {hasMismatch && (
        <div className="mt-4 w-full max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 text-xs text-amber-800 dark:text-amber-300">
              {selected === "personal"
                ? "This looks like a work email. If you're using OpenHelm commercially, select Business use — or go back to use a different email."
                : "This looks like a work email, not an institutional address. If you're at a university, go back and use your institutional email."}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="mt-2 text-xs"
          >
            Change email
          </Button>
        </div>
      )}

      {selected === "business" && (
        <div className="mt-4 w-full max-w-sm">
          <p className="mb-2 text-left text-xs text-muted-foreground">
            How many people will use OpenHelm in your organisation?
          </p>
          <Select
            value={employeeCount}
            onValueChange={(v) => setEmployeeCount(v as EmployeeCount)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {employeeCount === "1-3" && (
            <p className="mt-2 text-left text-xs text-green-600 dark:text-green-400">
              You qualify for the free Community tier.
            </p>
          )}
          {employeeCount !== "1-3" && (
            <p className="mt-2 text-left text-xs text-muted-foreground">
              Business license required — includes a 14-day free trial.
            </p>
          )}
        </div>
      )}

      <Button
        onClick={handleContinue}
        size="lg"
        className="mt-6 w-full max-w-sm"
        disabled={!selected || saving}
      >
        {saving ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
