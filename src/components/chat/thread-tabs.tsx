import { useRef, useState } from "react";
import { Plus, Pencil, Trash2, GripVertical, X, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

interface ThreadTabsProps {
  projectId: string | null;
}

export function ThreadTabs({ projectId }: ThreadTabsProps) {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createThread,
    renameThread,
    deleteThread,
    reorderThreads,
  } = useChatStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleCreate = () => {
    createThread(projectId);
    // Scroll to end after creation
    setTimeout(() => {
      scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
    }, 50);
  };

  const startRename = (id: string, currentTitle: string | null, idx: number) => {
    setRenamingId(id);
    setRenameValue(currentTitle ?? `Thread ${idx + 1}`);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameThread(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = (id: string) => {
    deleteThread(id, projectId);
  };

  // Drag-and-drop reorder
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const ids = conversations.map((c) => c.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(targetIdx, 0, moved);
    reorderThreads(ids);
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="flex items-center gap-1 border-b border-border/50 bg-muted/30 px-2 py-1">
      <div
        ref={scrollRef}
        className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-hide"
      >
        {conversations.map((conv, idx) => {
          const isActive = conv.id === activeConversationId;
          const label = conv.title ?? `Thread ${idx + 1}`;
          const isDragOver = dragOverIdx === idx && dragIdx !== idx;

          if (renamingId === conv.id) {
            return (
              <div key={conv.id} className="flex items-center gap-0.5 shrink-0">
                <input
                  autoFocus
                  className="h-6 w-24 rounded border border-primary bg-background px-1.5 text-[11px] outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={commitRename}
                />
                <Button variant="ghost" size="sm" className="size-5 p-0" onClick={commitRename}>
                  <Check className="size-3" />
                </Button>
                <Button variant="ghost" size="sm" className="size-5 p-0" onClick={() => setRenamingId(null)}>
                  <X className="size-3" />
                </Button>
              </div>
            );
          }

          return (
            <div
              key={conv.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "group relative flex shrink-0 items-center",
                isDragOver && "border-l-2 border-primary",
              )}
            >
              {/* Main pill — switches thread on click */}
              <button
                type="button"
                onClick={() => setActiveConversation(conv.id)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm rounded-r-none pr-1"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <GripVertical className="size-2.5 opacity-0 group-hover:opacity-40 cursor-grab" />
                <span className="max-w-[100px] truncate">{label}</span>
              </button>
              {/* Dropdown trigger — separate chevron, only visible on active tab or hover */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "flex items-center rounded-r-full py-0.5 pr-1.5 pl-0.5 text-[11px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm opacity-70 hover:opacity-100"
                        : "bg-muted/60 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted",
                    )}
                  >
                    <ChevronDown className="size-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px]">
                  <DropdownMenuItem onClick={() => startRename(conv.id, conv.title, idx)}>
                    <Pencil className="mr-2 size-3" />
                    Rename
                  </DropdownMenuItem>
                  {conversations.length > 1 && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDelete(conv.id)}
                    >
                      <Trash2 className="mr-2 size-3" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCreate}
        title="New thread"
        className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
