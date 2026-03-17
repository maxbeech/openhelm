import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Memory, MemoryType } from "@openorchestra/shared";
import { DEFAULT_MEMORY_TAGS } from "@openorchestra/shared";

interface MemoryEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memory: Memory | null;
  onSave: (data: {
    id: string;
    type: MemoryType;
    content: string;
    importance: number;
    tags: string[];
  }) => void;
}

export function MemoryEditDialog({
  open,
  onOpenChange,
  memory,
  onSave,
}: MemoryEditDialogProps) {
  const [type, setType] = useState<MemoryType>("semantic");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    if (memory) {
      setType(memory.type);
      setContent(memory.content);
      setImportance(memory.importance);
      setSelectedTags(memory.tags);
    }
  }, [memory]);

  const handleSave = () => {
    if (!memory || !content.trim()) return;
    onSave({
      id: memory.id,
      type,
      content: content.trim(),
      importance,
      tags: selectedTags,
    });
    onOpenChange(false);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  // Collect all unique tags (defaults + existing on the memory)
  const allTagOptions = [
    ...new Set([...DEFAULT_MEMORY_TAGS, ...selectedTags]),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Memory</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          <div>
            <label className="mb-1 block text-xs font-medium">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

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

          <div>
            <label className="mb-1 block text-xs font-medium">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {allTagOptions.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
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
            disabled={!content.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
