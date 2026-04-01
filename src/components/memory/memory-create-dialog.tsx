import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useProjectStore } from "@/stores/project-store";
import type { MemoryType } from "@openhelm/shared";
import { DEFAULT_MEMORY_TAGS } from "@openhelm/shared";

interface MemoryCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSave: (data: {
    type: MemoryType;
    content: string;
    importance: number;
    tags: string[];
    projectId: string;
  }) => void;
}

export function MemoryCreateDialog({
  open,
  onOpenChange,
  projectId,
  onSave,
}: MemoryCreateDialogProps) {
  const { projects } = useProjectStore();
  const [type, setType] = useState<MemoryType>("semantic");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");

  // Sync when projectId prop changes
  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId);
  }, [projectId]);

  const handleSave = () => {
    if (!content.trim() || !selectedProjectId) return;
    onSave({ type, content: content.trim(), importance, tags: selectedTags, projectId: selectedProjectId });
    setContent("");
    setImportance(5);
    setSelectedTags([]);
    onOpenChange(false);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Memory</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project (only shown when All Projects mode) */}
          {!projectId && (
            <div>
              <label className="mb-1 block text-xs font-medium">Project</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-medium">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="semantic">Fact</option>
              <option value="episodic">Experience</option>
              <option value="procedural">Workflow</option>
              <option value="source">Source</option>
            </select>
          </div>

          {/* Content */}
          <div>
            <label className="mb-1 block text-xs font-medium">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="One atomic idea (1-2 sentences)..."
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Importance */}
          <div>
            <label className="mb-1 block text-xs font-medium">
              Importance: {(importance / 10).toFixed(1)}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-xs font-medium">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_MEMORY_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-2 py-0.5 text-2xs transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim() || !selectedProjectId}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
