import { useState, useCallback } from "react";
import { Eye, EyeOff, Pencil, Trash2, Globe, Folder, Target, Briefcase, ShieldAlert, ShieldCheck } from "lucide-react";
import { CredentialTypeBadge } from "./credential-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCredentialStore } from "@/stores/credential-store";
import type { Credential, CredentialWithValue } from "@openhelm/shared";

const scopeIcons: Record<string, typeof Globe> = {
  global: Globe,
  project: Folder,
  goal: Target,
  job: Briefcase,
};

const scopeLabels: Record<string, string> = {
  global: "All Projects",
  project: "Project",
  goal: "Goal",
  job: "Job",
};

interface CredentialCardProps {
  credential: Credential;
  onEdit: (credential: Credential) => void;
  onDelete: (id: string) => void;
}

export function CredentialCard({ credential, onEdit, onDelete }: CredentialCardProps) {
  const { revealValue } = useCredentialStore();
  const [revealed, setRevealed] = useState<CredentialWithValue | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ScopeIcon = scopeIcons[credential.scopeType] ?? Globe;

  const handleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    const result = await revealValue(credential.id);
    setRevealed(result);
    setRevealing(false);
  }, [credential.id, revealed, revealValue]);

  const formatValue = (cred: CredentialWithValue): string => {
    if (!cred.value) return "(empty)";
    if (cred.value.type === "username_password") {
      return `${cred.value.username} / ${cred.value.password}`;
    }
    return cred.value.value;
  };

  return (
    <div className="group rounded-lg border border-border bg-card p-3">
      {/* Row 1: Name + badges */}
      <div className="mb-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-foreground">{credential.name}</span>
        <CredentialTypeBadge type={credential.type} />
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          <ScopeIcon className="mr-1 size-2.5" />
          {scopeLabels[credential.scopeType]}
        </Badge>
        {credential.allowPromptInjection ? (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/20">
            <ShieldAlert className="mr-1 size-2.5" />
            Prompt Access
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-green-400 border-green-500/20">
            <ShieldCheck className="mr-1 size-2.5" />
            Env Only
          </Badge>
        )}
        {!credential.isEnabled && (
          <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-500/20">
            Disabled
          </Badge>
        )}
      </div>

      {/* Row 2: Env var name */}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {credential.type === "username_password" ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {credential.envVarName}_USERNAME / {credential.envVarName}_PASSWORD
          </code>
        ) : (
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {credential.envVarName}
          </code>
        )}
      </div>

      {/* Row 3: Masked value + actions */}
      <div className="flex items-center gap-2">
        <div className="flex-1 font-mono text-xs text-muted-foreground">
          {revealed ? formatValue(revealed) : "••••••••••••"}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          onClick={handleReveal}
          disabled={revealing}
          title={revealed ? "Hide value" : "Reveal value"}
        >
          {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 opacity-0 group-hover:opacity-100"
          onClick={() => onEdit(credential)}
          title="Edit"
        >
          <Pencil className="size-3.5" />
        </Button>
        {confirmDelete ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[11px]"
            onClick={() => { onDelete(credential.id); setConfirmDelete(false); }}
          >
            Confirm
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 opacity-0 group-hover:opacity-100 text-destructive"
            onClick={() => setConfirmDelete(true)}
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Row 4: Last used */}
      {credential.lastUsedAt && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/60">
          Last used {new Date(credential.lastUsedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
