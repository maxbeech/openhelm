import { useRef, useState, useMemo } from "react";
import { Plus, Pencil, Trash2, X, Check, ChevronDown } from "lucide-react";
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
    clearChat,
    reorderThreads,
  } = useChatStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Dynamic max-width: show more title when fewer tabs are open
  const tabMaxWidth = useMemo(() => {
    const count = conversations.length;
    if (count <= 2) return "max-w-[280px]";
    if (count <= 3) return "max-w-[200px]";
    if (count <= 5) return "max-w-[150px]";
    return "max-w-[100px]";
  }, [conversations.length]);

  const handleCreate = () => {
    // If there's already a blank (untitled) thread, switch to it instead of creating another.
    const blankThread = conversations.find((c) => !c.title);
    if (blankThread) {
      setActiveConversation(blankThread.id);
      return;
    }
    createThread(projectId);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
    }, 50);
  };

  const startRename = (id: string, currentTitle: string | null) => {
    setRenamingId(id);
    setRenameValue(currentTitle ?? "New Chat");
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameThread(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = (id: string) => deleteThread(id, projectId);

  const handleClear = () => {
    if (!activeConversationId) return;
    clearChat(projectId).catch(() => {});
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
    <div className="flex items-center gap-1 border-b border-border/50 bg-card/50 px-2 py-1">
      <div
        ref={scrollRef}
        className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-hide"
      >
        {conversations.map((conv, idx) => {
          const isActive = conv.id === activeConversationId;
          const label = conv.title ?? "New Chat";
          const isDragOver = dragOverIdx === idx && dragIdx !== idx;

          if (renamingId === conv.id) {
            return (
              <div key={conv.id} className="flex items-center gap-0.5 shrink-0">
                <input
                  autoFocus
                  className="h-5 w-24 rounded border border-primary bg-background px-1.5 text-3xs outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={commitRename}
                />
                <Button variant="ghost" size="sm" className="size-4 p-0" onClick={commitRename}>
                  <Check className="size-2.5" />
                </Button>
                <Button variant="ghost" size="sm" className="size-4 p-0" onClick={() => setRenamingId(null)}>
                  <X className="size-2.5" />
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
                "group relative flex shrink-0 cursor-grab items-center active:cursor-grabbing",
                isDragOver && "border-l-2 border-primary",
              )}
            >
              <DropdownMenu>
                <button
                  type="button"
                  onClick={() => setActiveConversation(conv.id)}
                  className={cn(
                    "flex h-5 items-center gap-0.5 rounded-md px-2 text-3xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                    isActive
                      ? "bg-primary/90 text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className={cn(tabMaxWidth, "truncate")}>{label}</span>
                </button>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "flex h-5 items-center rounded-md px-0.5 transition-opacity cursor-pointer",
                      isActive
                        ? "text-primary-foreground/70 hover:text-primary-foreground"
                        : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100",
                    )}
                  >
                    <ChevronDown className="size-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[120px]">
                  <DropdownMenuItem onClick={() => startRename(conv.id, conv.title)}>
                    <Pencil className="mr-2 size-3" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleClear}>
                    <Trash2 className="mr-2 size-3" />
                    Clear history
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleDelete(conv.id)}
                  >
                    <X className="mr-2 size-3" />
                    Delete thread
                  </DropdownMenuItem>
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
        className="size-5 shrink-0 p-0 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}
