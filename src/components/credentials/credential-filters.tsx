import { useCredentialStore } from "@/stores/credential-store";
import { Button } from "@/components/ui/button";
import type { CredentialType, CredentialScope } from "@openhelm/shared";

const typeOptions: { value: CredentialType; label: string }[] = [
  { value: "username_password", label: "Username & Password" },
  { value: "token", label: "Token" },
];

const scopeOptions: { value: CredentialScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "project", label: "Project" },
  { value: "goal", label: "Goal" },
  { value: "job", label: "Job" },
];

export function CredentialFilters() {
  const { filterType, filterScope, setFilterType, setFilterScope } = useCredentialStore();

  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Type filters */}
      {typeOptions.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={filterType === opt.value ? "secondary" : "ghost"}
          className="h-7 text-2xs"
          onClick={() => setFilterType(filterType === opt.value ? null : opt.value)}
        >
          {opt.label}
        </Button>
      ))}

      <div className="mx-1 h-7 w-px bg-border" />

      {/* Scope filters */}
      {scopeOptions.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={filterScope === opt.value ? "secondary" : "ghost"}
          className="h-7 text-2xs"
          onClick={() => setFilterScope(filterScope === opt.value ? null : opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
