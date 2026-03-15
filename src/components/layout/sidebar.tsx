import { useCallback } from "react";
import { Settings, ChevronDown, Plus, Inbox, Layers } from "lucide-react";
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
import { SidebarTree } from "./sidebar-tree";

interface SidebarProps {
  onNewProject?: () => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function Sidebar({ onNewProject, onNewJobForGoal }: SidebarProps) {
  const { contentView, setContentView, activeProjectId, setActiveProjectId } =
    useAppStore();
  const { projects } = useProjectStore();
  const { openCount } = useInboxStore();

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
        <h1 className="text-sm font-bold tracking-tight">
          <span className="text-primary">Open</span>
          <span className="text-sidebar-foreground">Orchestra</span>
        </h1>
      </div>

      {/* Inbox */}
      <div className="px-2 pt-2">
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
      </div>

      {/* Project filter — same sizing as Inbox */}
      <div className="border-b border-sidebar-border px-2 pb-2 pt-0.5">
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
                onClick={() => handleProjectSwitch(p.id)}
                className={cn(p.id === activeProjectId && "bg-accent")}
              >
                <div className="flex size-4 items-center justify-center rounded bg-primary/20 text-[9px] font-bold text-primary">
                  {p.name[0]?.toUpperCase()}
                </div>
                <span className="truncate">{p.name}</span>
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
