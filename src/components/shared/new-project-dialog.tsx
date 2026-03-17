import { useState } from "react";
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
import { FolderOpen } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string) => void;
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [directoryPath, setDirectoryPath] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createProject } = useProjectStore();

  const pickDirectory = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected) setDirectoryPath(selected as string);
    } catch {
      // Fallback to manual entry
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !directoryPath.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        directoryPath: directoryPath.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDirectoryPath("");
      setDescription("");
      onCreated(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-dir">Directory</Label>
            <div className="flex gap-2">
              <Input
                id="proj-dir"
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
            <Label htmlFor="proj-desc">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the project"
              rows={2}
              className="max-h-32 overflow-y-auto"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !directoryPath.trim() || creating}
            className="w-full"
          >
            {creating ? "Creating..." : "Create project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
