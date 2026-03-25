import { Badge } from "@/components/ui/badge";
import type { CredentialType } from "@openhelm/shared";

const typeLabels: Record<CredentialType, string> = {
  token: "Token",
  username_password: "Username & Password",
};

const typeColors: Record<CredentialType, string> = {
  token: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  username_password: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

export function CredentialTypeBadge({ type }: { type: CredentialType }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${typeColors[type]}`}>
      {typeLabels[type]}
    </Badge>
  );
}
