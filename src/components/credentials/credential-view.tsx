import { useEffect, useState, useCallback } from "react";
import { Plus, KeyRound } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useCredentialStore } from "@/stores/credential-store";
import { PageHeader } from "@/components/shared/page-header";
import { CredentialFilters } from "./credential-filters";
import { CredentialCard } from "./credential-card";
import { CredentialCreateDialog } from "./credential-create-dialog";
import { CredentialEditDialog } from "./credential-edit-dialog";
import { Button } from "@/components/ui/button";
import type { Credential, CredentialType, CredentialScope, CredentialScopeBinding, CredentialValue } from "@openhelm/shared";

export function CredentialView() {
  const { activeProjectId } = useAppStore();
  const {
    credentials,
    loading,
    filterType,
    filterScope,
    searchQuery,
    fetchCredentials,
    createCredential,
    updateCredential,
    deleteCredential,
  } = useCredentialStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
  const [crudError, setCrudError] = useState<string | null>(null);

  useEffect(() => {
    fetchCredentials(activeProjectId);
  }, [activeProjectId, filterType, filterScope, fetchCredentials]);

  // Apply client-side filters
  const filtered = credentials.filter((c) => {
    if (filterType && c.type !== filterType) return false;
    if (filterScope && c.scopeType !== filterScope) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!c.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleCreate = useCallback(
    async (data: {
      name: string;
      type: CredentialType;
      allowPromptInjection?: boolean;
      allowBrowserInjection?: boolean;
      value: CredentialValue;
      scopes: CredentialScopeBinding[];
    }) => {
      setCrudError(null);
      try {
        const result = await createCredential(data);
        fetchCredentials(activeProjectId);
        return result;
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to create credential");
        throw err;
      }
    },
    [activeProjectId, createCredential, fetchCredentials],
  );

  const handleEdit = useCallback(
    async (data: {
      id: string;
      name?: string;
      allowPromptInjection?: boolean;
      allowBrowserInjection?: boolean;
      value?: CredentialValue;
      scopeType?: CredentialScope;
      scopeId?: string;
      scopes?: CredentialScopeBinding[] | null;
      isEnabled?: boolean;
    }) => {
      setCrudError(null);
      try {
        await updateCredential(data);
        fetchCredentials(activeProjectId);
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to update credential");
      }
    },
    [activeProjectId, updateCredential, fetchCredentials],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setCrudError(null);
      try {
        await deleteCredential(id);
        fetchCredentials(activeProjectId);
      } catch (err) {
        setCrudError(err instanceof Error ? err.message : "Failed to delete credential");
      }
    },
    [activeProjectId, deleteCredential, fetchCredentials],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Credentials"
        subtitle="Store API keys, passwords, and secrets securely in macOS Keychain."
        count={filtered.length}
        actions={
          <Button
            size="sm"
            variant="secondary"
            className="text-2xs"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="mr-1 size-3" />
            New Credential
          </Button>
        }
        filters={<CredentialFilters />}
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {crudError && (
          <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {crudError}
          </div>
        )}
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading credentials...
          </p>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center">
            <KeyRound className="mx-auto mb-3 size-10 text-muted-foreground/30" />
            <p className="mb-3 text-sm text-muted-foreground">
              {filterType || filterScope
                ? "No credentials match your filters."
                : "No credentials yet. Inject them into your jobs."}
            </p>
            {!filterType && !filterScope && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add Credential
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((cred) => (
              <CredentialCard
                key={cred.id}
                credential={cred}
                onEdit={setEditingCredential}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CredentialCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        projectId={activeProjectId}
        onSave={handleCreate}
      />
      <CredentialEditDialog
        open={!!editingCredential}
        onOpenChange={(open) => { if (!open) setEditingCredential(null); }}
        credential={editingCredential}
        projectId={activeProjectId}
        onSave={handleEdit}
      />
    </div>
  );
}
