/**
 * CredentialTags — displays the credentials associated with a project/goal/job
 * as compact read-only badges. Shows prompt access indicator.
 */
import { useEffect, useState } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listCredentialsByScope } from "@/lib/api";
import type { Credential } from "@openhelm/shared";

interface Props {
  scopeType: "project" | "goal" | "job";
  scopeId: string;
  /** Refresh key — increment to trigger a re-fetch (e.g. after editing) */
  refreshKey?: number;
}

export function CredentialTags({ scopeType, scopeId, refreshKey = 0 }: Props) {
  const [credentials, setCredentials] = useState<Credential[]>([]);

  useEffect(() => {
    listCredentialsByScope({ scopeType, scopeId })
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, [scopeType, scopeId, refreshKey]);

  if (credentials.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {credentials.map((c) => (
        <Badge
          key={c.id}
          variant="secondary"
          className={`gap-1 text-xs ${c.allowPromptInjection ? "border-amber-500/30 bg-amber-500/10" : ""}`}
        >
          <KeyRound className="size-3 shrink-0 text-muted-foreground" />
          {c.name}
          {c.allowPromptInjection && (
            <ShieldAlert className="size-3 shrink-0 text-amber-400" />
          )}
        </Badge>
      ))}
    </div>
  );
}
