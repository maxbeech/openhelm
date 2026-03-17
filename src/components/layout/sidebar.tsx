import { useCallback } from "react";
import { Settings, ChevronDown, Plus, Inbox, Layers, Waypoints, Pencil } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useProjectStore } from "@/stores/project-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useInboxStore } from "@/stores/inbox-store";
import { useMemoryStore } from "@/stores/memory-store";
import { SidebarTree } from "./sidebar-tree";

interface SidebarProps {
  onNewProject?: () => void;
  onEditProject?: (projectId: string) => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function Sidebar({ onNewProject, onEditProject, onNewJobForGoal }: SidebarProps) {
  const { contentView, setContentView, activeProjectId, setActiveProjectId } =
    useAppStore();
  const { projects } = useProjectStore();
  const { openCount } = useInboxStore();
  const { memoryCount } = useMemoryStore();

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleProjectSwitch = useCallback(
    (id: string | null) => {
      setActiveProjectId(id);
    },
    [setActiveProjectId],
  );

  return (
    <aside className="no-select flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="border-b border-sidebar-border px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight text-white">
          OpenOrchestra
        </h1>
      </div>

      {/* Project selector */}
      <div className="border-b border-sidebar-border px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}>
            <Layers className="size-4" />
            <span className="flex-1 truncate text-left">
              {activeProject?.name ?? "All Projects"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem
              onClick={() => handleProjectSwitch(null)}
              className={cn(!activeProjectId && "bg-accent")}
            >
              <Layers className="size-4 text-muted-foreground" />
              <span>All Projects</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-edit-btn]")) return;
                  handleProjectSwitch(p.id);
                }}
                className={cn("group pr-1", p.id === activeProjectId && "bg-accent")}
              >
                <div className="flex size-4 items-center justify-center rounded bg-primary/20 text-[9px] font-bold text-primary">
                  {p.name[0]?.toUpperCase()}
                </div>
                <span className="flex-1 truncate">{p.name}</span>
                <button
                  data-edit-btn
                  className="ml-1 flex size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditProject?.(p.id);
                  }}
                  title="Edit project"
                >
                  <Pencil className="size-3 text-muted-foreground" />
                </button>
              </DropdownMenuItem>
            ))}
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={onNewProject}>
              <Plus className="size-4" />
              New project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inbox + Memory */}
      <div className="border-b border-sidebar-border px-2 py-2 space-y-0.5">
        <button
          onClick={() => setContentView("inbox")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            contentView === "inbox"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Inbox className="size-4" />
          <span className="flex-1 text-left">Inbox</span>
          {openCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {openCount > 99 ? "99+" : openCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setContentView("memory")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            contentView === "memory"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Waypoints className="size-4" />
          <span className="flex-1 text-left">Memory</span>
          {memoryCount > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {memoryCount}
            </span>
          )}
        </button>
      </div>

      {/* Tree Navigation */}
      <SidebarTree
        projectId={activeProjectId}
        onNewJobForGoal={onNewJobForGoal}
      />

      {/* Settings at bottom */}
      <div className="mt-auto border-t border-sidebar-border p-2">
        <button
          onClick={() => setContentView("settings")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            contentView === "settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <Settings className="size-4" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
