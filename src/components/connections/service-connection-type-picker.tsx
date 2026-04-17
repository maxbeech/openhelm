import { Cpu, Terminal, Globe, Key, User } from "lucide-react";
import type { ConnectionType } from "@openhelm/shared";
import { BrandIcon } from "./brand-icon";
import type { SelectedService } from "./service-search-input";

interface Props {
  service: SelectedService;
  onPick: (type: ConnectionType) => void;
}

interface TypeOption {
  type: ConnectionType;
  icon: typeof Key;
  title: string;
  description: string;
  recommended?: boolean;
}

/** Which connection types are applicable for a given service? */
function applicableTypes(service: SelectedService): TypeOption[] {
  const name = service.displayName;
  const entry = service.entry;
  const hasMcp = !!(service.mcpServerId || entry?.hasMcp);
  const hasCli = !!entry?.hasCli;

  const options: TypeOption[] = [];

  if (hasMcp) {
    options.push({
      type: "mcp",
      icon: Cpu,
      title: `${name} MCP`,
      description: "Official MCP server — tools installed for you, OAuth handled automatically.",
      recommended: true,
    });
  }
  if (hasCli) {
    options.push({
      type: "cli",
      icon: Terminal,
      title: `${name} CLI`,
      description: "Official command-line tool, preinstalled in cloud or installed on demand locally.",
    });
  }
  options.push({
    type: "browser",
    icon: Globe,
    title: `${name}.com`,
    description: "Log in once with your browser; session stays available for jobs.",
  });
  options.push({
    type: "token",
    icon: Key,
    title: `${name} token`,
    description: "Paste an API key — exposed to the job via environment variable.",
  });
  options.push({
    type: "plain_text",
    icon: User,
    title: "Plain text",
    description: "Username / password inserted directly into the prompt. High risk — last resort.",
  });

  return options;
}

export function ServiceConnectionTypePicker({ service, onPick }: Props) {
  const options = applicableTypes(service);
  const slug = service.entry?.iconSlug ?? service.entry?.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded border border-border bg-sidebar-accent/30 px-3 py-2">
        <BrandIcon slug={slug} size={20} />
        <div>
          <p className="text-sm font-medium">{service.displayName}</p>
          {service.entry?.description && (
            <p className="text-2xs text-muted-foreground line-clamp-1">{service.entry.description}</p>
          )}
        </div>
      </div>

      <p className="text-2xs text-muted-foreground">
        Choose how you&apos;d like to connect. We recommend the most secure option available.
      </p>

      <div className="space-y-1.5">
        {options.map(({ type, icon: Icon, title, description, recommended }) => (
          <button
            key={type}
            onClick={() => onPick(type)}
            className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-sidebar-accent/50"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{title}</span>
                {recommended && (
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-3xs text-green-300">
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-2xs text-muted-foreground">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
