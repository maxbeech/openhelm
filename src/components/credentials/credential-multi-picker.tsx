/**
 * CredentialMultiPicker — searchable multi-select for associating credentials
 * with a project, goal, or job.
 * Shows all available credentials in a dropdown with checkboxes.
 * Selected credentials are displayed as removable tags below.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { ChevronDown, X, Search, KeyRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCredentialStore } from "@/stores/credential-store";
import type { Credential, ListCredentialsByScopeParams } from "@openhelm/shared";

interface Props {
  /** Currently selected credential IDs */
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * When provided, pre-loads credentials that are already bound to this scope
   * so the picker initialises with them checked.
   */
  existingScope?: ListCredentialsByScopeParams;
}

export function CredentialMultiPicker({ value, onChange, existingScope }: Props) {
  const { credentials, fetchCredentials, fetchForScope } = useCredentialStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Load all credentials and pre-select those already bound to this scope.
  // Re-runs when the scope changes (e.g. edit sheet opened for a different goal).
  useEffect(() => {
    fetchCredentials(null);
    if (existingScope) {
      fetchForScope(existingScope).then((bound) => {
        onChange(bound.map((c) => c.id));
        setInitialized(true);
      });
    } else {
      setInitialized(true);
    }
  // existingScope is an inline object — use primitive fields as deps to avoid infinite loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingScope?.scopeType, existingScope?.scopeId]);

  const lc = search.toLowerCase();
  const filtered = useMemo(
    () =>
      credentials.filter(
        (c) =>
          !lc ||
          c.name.toLowerCase().includes(lc) ||
          c.envVarName.toLowerCase().includes(lc),
      ),
    [credentials, lc],
  );

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  const selectedCredentials = useMemo<Credential[]>(
    () => credentials.filter((c) => value.includes(c.id)),
    [credentials, value],
  );

  const triggerLabel =
    value.length === 0
      ? "Select credentials…"
      : `${value.length} credential${value.length === 1 ? "" : "s"} selected`;

  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 px-3 font-normal text-sm"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={value.length === 0 ? "text-muted-foreground" : ""}>
            {triggerLabel}
          </span>
          <ChevronDown className={`ml-2 size-4 shrink-0 opacity-50 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>

        {open && (
          <div className="absolute left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
            {/* Search */}
            <div className="flex items-center border-b border-border px-3">
              <Search className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search credentials…"
                className="h-9 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                autoFocus
              />
            </div>

            {/* Credential list */}
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">No credentials found</p>
              )}
              {filtered.map((cred) => (
                <label
                  key={cred.id}
                  className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={value.includes(cred.id)}
                    onCheckedChange={() => toggle(cred.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{cred.name}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {cred.envVarName}
                      {cred.type === "username_password"
                        ? `  /  ${cred.envVarName}_USERNAME / ${cred.envVarName}_PASSWORD`
                        : ""}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected tags */}
      {selectedCredentials.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCredentials.map((cred) => (
            <Badge key={cred.id} variant="secondary" className="gap-1 pr-1 text-xs">
              <KeyRound className="size-3 shrink-0 text-muted-foreground" />
              {cred.name}
              <button
                type="button"
                onClick={() => toggle(cred.id)}
                className="ml-0.5 rounded-sm hover:bg-muted"
                aria-label={`Remove ${cred.name}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
