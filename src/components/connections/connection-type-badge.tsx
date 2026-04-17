import { Badge } from "@/components/ui/badge";
import { Folder, Cpu, Terminal, Globe, Key, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionType } from "@openhelm/shared";

const typeConfig: Record<ConnectionType, { label: string; icon: typeof Key; className: string }> = {
  folder: { label: "Folder", icon: Folder, className: "text-blue-400 border-blue-500/20" },
  mcp: { label: "MCP", icon: Cpu, className: "text-purple-400 border-purple-500/20" },
  cli: { label: "CLI", icon: Terminal, className: "text-cyan-400 border-cyan-500/20" },
  browser: { label: "Browser", icon: Globe, className: "text-green-400 border-green-500/20" },
  token: { label: "Token", icon: Key, className: "text-amber-400 border-amber-500/20" },
  plain_text: { label: "Password", icon: User, className: "text-orange-400 border-orange-500/20" },
};

interface Props {
  type: ConnectionType;
  className?: string;
}

export function ConnectionTypeBadge({ type, className }: Props) {
  const config = typeConfig[type];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn("text-3xs", config.className, className)}>
      <Icon className="mr-1 size-2.5" />
      {config.label}
    </Badge>
  );
}
