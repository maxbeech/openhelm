import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FolderOpen, Trash2 } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { CredentialMultiPicker } from "@/components/credentials/credential-multi-picker";
import { setCredentialScopesForEntity } from "@/lib/api";
import type { Project } from "@openhelm/shared";

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSaved: (project: Project) => void;
  onDeleted: (projectId: string) => void;
}

export function EditProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
  onDeleted,
}: EditProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const [directoryPath, setDirectoryPath] = useState(project.directoryPath);
  const [description, setDescription] = useState(project.description ?? "");
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { updateProject, deleteProject } = useProjectStore();

  // Sync fields when project prop changes
  useEffect(() => {
    setName(project.name);
    setDirectoryPath(project.directoryPath);
    setDescription(project.description ?? "");
    setConfirmDelete(false);
    setError(null);
  }, [project]);

  const pickDirectory = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected) setDirectoryPath(selected as string);
    } catch {
      // Fallback to manual entry
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !directoryPath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject({
        id: project.id,
        name: name.trim(),
        directoryPath: directoryPath.trim(),
        description: description.trim() || undefined,
      });
      await setCredentialScopesForEntity({ scopeType: "project", scopeId: project.id, credentialIds });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(project.id);
      onDeleted(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setDeleting(false);
    }
  };

  const isDirty =
    name.trim() !== project.name ||
    directoryPath.trim() !== project.directoryPath ||
    (description.trim() || undefined) !== (project.description ?? undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-proj-name">Name</Label>
            <Input
              id="edit-proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-proj-dir">Directory</Label>
            <div className="flex gap-2">
              <Input
                id="edit-proj-dir"
                value={directoryPath}
                onChange={(e) => setDirectoryPath(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={pickDirectory}>
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-proj-desc">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="edit-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the project"
              rows={2}
              className="max-h-32 overflow-y-auto"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Credentials (optional)</Label>
            <CredentialMultiPicker
              value={credentialIds}
              onChange={setCredentialIds}
              existingScope={{ scopeType: "project", scopeId: project.id }}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            onClick={handleSave}
            disabled={!name.trim() || !directoryPath.trim() || saving}
            className="w-full"
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>

          {/* Delete section */}
          <div className="border-t border-border pt-3">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This will remove{" "}
                  <span className="font-medium text-foreground">{project.name}</span>{" "}
                  from OpenHelm. Your files will not be affected.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Confirm delete"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="mr-2 size-4" />
                Delete project
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
