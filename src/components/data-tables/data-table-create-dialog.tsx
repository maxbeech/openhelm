import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDataTableStore } from "@/stores/data-table-store";
import { useProjectStore } from "@/stores/project-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onCreated: () => void;
}

export function DataTableCreateDialog({ open, onOpenChange, projectId, onCreated }: Props) {
  const { createTable } = useDataTableStore();
  const { projects } = useProjectStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId ?? "");
  const [saving, setSaving] = useState(false);

  // Sync selectedProjectId when projectId prop changes (e.g. dialog re-opens)
  const effectiveProjectId = selectedProjectId || projectId || "";

  const handleSave = async () => {
    if (!name.trim() || !effectiveProjectId) return;
    setSaving(true);
    const result = await createTable({
      projectId: effectiveProjectId,
      name: name.trim(),
      description: description.trim() || undefined,
      columns: [],
    });
    setSaving(false);
    if (result) {
      setName("");
      setDescription("");
      setSelectedProjectId(projectId ?? "");
      onCreated();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName("");
      setDescription("");
      setSelectedProjectId(projectId ?? "");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Data Table</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="e.g. Customers, Content Calendar"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What data does this table track?"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 text-3xs text-muted-foreground/60">
              Used by the AI to find relevant tables during job execution.
            </p>
          </div>

          {/* Project */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Project</label>
            <select
              value={effectiveProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {!effectiveProjectId && (
                <option value="" disabled>Select a project</option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => handleOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !effectiveProjectId || saving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Creating..." : "Create Table"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
