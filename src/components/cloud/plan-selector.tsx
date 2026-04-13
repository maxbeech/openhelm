/**
 * PlanSelector — plan selection cards shown during onboarding and upgrade flows.
 *
 * Displays Starter / Growth / Scale with feature highlights. Calls back with
 * the selected plan name; billing integration (Stripe checkout) is handled by
 * the parent (PlanManager or OnboardingWizard).
 */

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CloudPlan = "basic" | "pro" | "max";

interface PlanDef {
  id: CloudPlan;
  name: string;
  price: string;
  period: string;
  tokens: string;
  highlighted?: boolean;
  features: string[];
}

const PLANS: PlanDef[] = [
  {
    id: "basic",
    name: "Basic",
    price: "£39",
    period: "/month",
    tokens: "50M tokens included",
    features: [
      "Unlimited projects",
      "Scheduled & manual jobs",
      "Real-time run streaming",
      "Chat with project context",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "£89",
    period: "/month",
    tokens: "200M tokens included",
    highlighted: true,
    features: [
      "Everything in Basic",
      "5% volume discount on overage",
      "Priority job queue",
      "Email support",
      "Usage analytics",
    ],
  },
  {
    id: "max",
    name: "Max",
    price: "£189",
    period: "/month",
    tokens: "1B tokens included",
    features: [
      "Everything in Pro",
      "10% volume discount on overage",
      "Highest concurrency limits",
      "Dedicated support channel",
      "Custom retention policy",
    ],
  },
];

interface PlanSelectorProps {
  currentPlan?: CloudPlan | null;
  onSelect: (plan: CloudPlan) => void;
  loading?: boolean;
}

export function PlanSelector({ currentPlan, onSelect, loading }: PlanSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {PLANS.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        return (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-lg border p-5 space-y-4 flex flex-col",
              plan.highlighted
                ? "border-primary bg-primary/5"
                : "border-border bg-card",
            )}
          >
            {plan.highlighted && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                Most popular
              </span>
            )}

            <div>
              <h3 className="font-semibold">{plan.name}</h3>
              <div className="mt-1 flex items-baseline gap-0.5">
                <span className="text-2xl font-bold">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{plan.tokens}</p>
            </div>

            <ul className="space-y-1.5 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check className="size-3.5 mt-0.5 text-green-500 shrink-0" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>

            <Button
              size="sm"
              variant={plan.highlighted ? "default" : "outline"}
              className="w-full"
              disabled={isCurrent || loading}
              onClick={() => onSelect(plan.id)}
            >
              {isCurrent ? "Current plan" : `Choose ${plan.name}`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
