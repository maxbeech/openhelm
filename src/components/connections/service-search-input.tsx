import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus } from "lucide-react";
import { BrandIcon } from "./brand-icon";
import { searchServices } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { ServiceSearchResult, ServiceCatalogueEntry } from "@openhelm/shared";

interface Props {
  onSelect: (result: SelectedService) => void;
  /** Optional: pre-seed the input (e.g. when re-opening after a back nav). */
  initialQuery?: string;
}

export interface SelectedService {
  /** Catalogue entry when one matched; null for custom / MCP-registry-only. */
  entry: ServiceCatalogueEntry | null;
  /** Name to prefill (catalogue name, MCP name, or the raw query). */
  displayName: string;
  /** Present when this originated from the live MCP registry. */
  mcpServerId?: string;
  mcpInstallCommand?: string[];
  mcpOauthRequired?: boolean;
  isCustom: boolean;
}

export function ServiceSearchInput({ onSelect, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ServiceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        // Folder hiding is enforced in local mode via the type picker, not search:
        // folders are not a searchable service concept.
        const res = await searchServices(q, { limit: 10 });
        if (!cancelled) setResults(res);
      } catch (err) {
        console.error("[service-search]", err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const handlePick = (r: ServiceSearchResult) => {
    if (r.isCustom) {
      onSelect({
        entry: null,
        displayName: query.trim(),
        isCustom: true,
      });
      return;
    }
    if (r.mcpRegistry) {
      onSelect({
        entry: null,
        displayName: r.mcpRegistry.name,
        mcpServerId: r.mcpRegistry.id,
        mcpInstallCommand: r.mcpRegistry.installCommand,
        mcpOauthRequired: r.mcpRegistry.oauthRequired,
        isCustom: false,
      });
      return;
    }
    if (r.entry) {
      onSelect({
        entry: r.entry,
        displayName: r.entry.name,
        mcpServerId: r.entry.mcpServerId,
        mcpInstallCommand: r.entry.mcpInstallCommand,
        mcpOauthRequired: r.entry.mcpOauthRequired,
        isCustom: false,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Search for a service</Label>
        <p className="text-2xs text-muted-foreground mb-2">
          e.g. GitHub, Notion, Slack{isLocalMode ? ", or a local folder (below)" : ""}. We&apos;ll suggest
          the best ways to connect.
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing..."
            className="pl-8"
          />
        </div>
      </div>

      {query.trim().length < 2 ? (
        <div className="rounded border border-dashed border-border p-4 text-center text-2xs text-muted-foreground">
          Type at least 2 characters to see matching services.
        </div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto rounded border border-border">
          {loading && results.length === 0 && (
            <div className="p-3 text-2xs text-muted-foreground">Searching...</div>
          )}
          {results.map((r, i) => (
            <ResultRow key={i} result={r} query={query} onPick={() => handlePick(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  result,
  query,
  onPick,
}: {
  result: ServiceSearchResult;
  query: string;
  onPick: () => void;
}) {
  if (result.isCustom) {
    return (
      <button
        onClick={onPick}
        className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm transition-colors first:border-t-0 hover:bg-sidebar-accent/60"
      >
        <Plus className="size-4 text-muted-foreground" />
        <span>Use &quot;{query.trim()}&quot; as a custom service</span>
      </button>
    );
  }
  const entry = result.entry;
  const mcp = result.mcpRegistry;
  const name = entry?.name ?? mcp?.name ?? "";
  const description = entry?.description ?? mcp?.description ?? "";
  const slug = entry?.iconSlug ?? entry?.id;
  return (
    <button
      onClick={onPick}
      className="flex w-full items-start gap-2.5 border-t border-border px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-sidebar-accent/60"
    >
      <BrandIcon slug={slug} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          {mcp?.verified && (
            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-3xs text-blue-300">
              Verified MCP
            </span>
          )}
        </div>
        {description && (
          <p className="text-2xs text-muted-foreground line-clamp-1">{description}</p>
        )}
      </div>
    </button>
  );
}
