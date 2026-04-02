import { useRef, useState, useMemo } from "react";
import { Plus, Pencil, Trash2, X, Check, ChevronDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";
import type { Conversation } from "@openhelm/shared";

interface ThreadTabsProps {
  projectId: string | null;
}

// ─── Shared tab button ──────────────────────────────────────────────────────

interface TabButtonProps {
  conv: Conversation;
  idx: number;
  isActive: boolean;
  tabMaxWidth: string;
  /** When true, render a floating "picked-up" style (used in DragOverlay). */
  isOverlay?: boolean;
  /** Pointer listeners forwarded from useSortable — applied to enable drag. */
  dragListeners?: Record<string, unknown>;
  onSelect: (id: string) => void;
  onStartRename: (id: string, title: string | null) => void;
  onDelete: (id: string) => void;
  onClearHistory: () => void;
}

function TabButton({
  conv,
  isActive,
  tabMaxWidth,
  isOverlay,
  dragListeners,
  onSelect,
  onStartRename,
  onDelete,
  onClearHistory,
}: TabButtonProps) {
  const label = conv.title ?? "New Chat";

  return (
    <DropdownMenu>
      {/* Pill wrapper owns the background so both label and chevron sit inside it */}
      <div
        className={cn(
          "group flex h-5 shrink-0 items-center rounded-md transition-colors",
          isOverlay
            ? "cursor-grabbing bg-primary/90 text-primary-foreground shadow-lg ring-1 ring-border/50"
            : isActive
            ? "bg-primary/90 text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <button
          type="button"
          {...(dragListeners as React.HTMLAttributes<HTMLButtonElement>)}
          onClick={() => !isOverlay && onSelect(conv.id)}
          className="flex h-5 cursor-default items-center gap-0.5 px-2 text-3xs font-medium whitespace-nowrap"
        >
          <span className={cn(tabMaxWidth, "truncate")}>{label}</span>
        </button>

        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex h-5 cursor-default items-center rounded-r-md pr-1 pl-0 transition-opacity",
              isActive || isOverlay
                ? "text-primary-foreground/70 hover:text-primary-foreground"
                : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
            )}
          >
            <ChevronDown className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="start" className="min-w-[120px]">
        <DropdownMenuItem onClick={() => onStartRename(conv.id, conv.title)}>
          <Pencil className="mr-2 size-3" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClearHistory}>
          <Trash2 className="mr-2 size-3" />
          Clear history
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDelete(conv.id)}
        >
          <X className="mr-2 size-3" />
          Delete thread
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Sortable wrapper per tab ────────────────────────────────────────────────

interface SortableTabProps extends Omit<TabButtonProps, "dragListeners" | "isOverlay"> {
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function SortableTab({
  conv,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  ...tabButtonProps
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: conv.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  if (isRenaming) {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-0.5 shrink-0">
        <input
          autoFocus
          className="h-5 w-24 rounded border border-primary bg-background px-1.5 text-3xs outline-none"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameCommit();
            if (e.key === "Escape") onRenameCancel();
          }}
          onBlur={onRenameCommit}
        />
        <Button variant="ghost" size="sm" className="size-4 p-0" onClick={onRenameCommit}>
          <Check className="size-2.5" />
        </Button>
        <Button variant="ghost" size="sm" className="size-4 p-0" onClick={onRenameCancel}>
          <X className="size-2.5" />
        </Button>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="shrink-0">
      <TabButton
        conv={conv}
        dragListeners={listeners}
        {...tabButtonProps}
      />
    </div>
  );
}

// ─── ThreadTabs ───────────────────────────────────────────────────────────────

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
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const tabMaxWidth = useMemo(() => {
    const count = conversations.length;
    if (count <= 2) return "max-w-[280px]";
    if (count <= 3) return "max-w-[200px]";
    if (count <= 5) return "max-w-[150px]";
    return "max-w-[100px]";
  }, [conversations.length]);

  const handleCreate = () => {
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

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveDragId(active.id as string);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const ids = conversations.map((c) => c.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    reorderThreads(arrayMove(ids, oldIdx, newIdx));
  };

  const activeDragConv = activeDragId
    ? conversations.find((c) => c.id === activeDragId) ?? null
    : null;

  const activeDragIdx = activeDragId
    ? conversations.findIndex((c) => c.id === activeDragId)
    : -1;

  const sharedTabProps = (conv: Conversation) => ({
    conv,
    idx: conversations.findIndex((c) => c.id === conv.id),
    isActive: conv.id === activeConversationId,
    tabMaxWidth,
    onSelect: setActiveConversation,
    onStartRename: startRename,
    onDelete: (id: string) => deleteThread(id, projectId),
    onClearHistory: () => {
      if (!activeConversationId) return;
      clearChat(projectId).catch(() => {});
    },
  });

  return (
    <div className="flex items-center gap-1 border-b border-border/50 bg-card/50 px-2 py-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={conversations.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollRef}
            className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-hide"
          >
            {conversations.map((conv) => (
              <SortableTab
                key={conv.id}
                isRenaming={renamingId === conv.id}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingId(null)}
                {...sharedTabProps(conv)}
              />
            ))}
          </div>
        </SortableContext>

        {/* Floating copy that follows the cursor while dragging */}
        <DragOverlay
          dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
        >
          {activeDragConv && (
            <TabButton
              {...sharedTabProps(activeDragConv)}
              idx={activeDragIdx}
              isOverlay
              onSelect={() => {}}
              onStartRename={() => {}}
              onDelete={() => {}}
              onClearHistory={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>

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
