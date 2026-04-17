import { Badge } from "@/components/ui/badge";
import type { ConnectionType } from "@openhelm/shared";

const typeLabels: Partial<Record<ConnectionType, string>> = {
  token: "Token",
  plain_text: "Username & Password",
  browser: "Browser",
  mcp: "MCP",
  cli: "CLI",
  folder: "Folder",
};

const typeColors: Partial<Record<ConnectionType, string>> = {
  token: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  plain_text: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  browser: "bg-green-500/10 text-green-400 border-green-500/20",
  mcp: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  cli: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  folder: "bg-sky-500/10 text-sky-400 border-sky-500/20",
};

export function CredentialTypeBadge({ type }: { type: ConnectionType }) {
  return (
    <Badge variant="outline" className={`text-3xs ${typeColors[type] ?? ""}`}>
      {typeLabels[type] ?? type}
    </Badge>
  );
}
