import { useCallback } from "react";
import { Settings, ChevronDown, Plus } from "lucide-react";
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
import { SidebarTree } from "./sidebar-tree";

interface SidebarProps {
  onNewProject?: () => void;
  onNewJobForGoal: (goalId: string, initialName: string) => void;
}

export function Sidebar({ onNewProject, onNewJobForGoal }: SidebarProps) {
  const { contentView, setContentView, activeProjectId, setActiveProjectId } =
    useAppStore();
  const { projects } = useProjectStore();

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleProjectSwitch = useCallback(
    (id: string) => {
      setActiveProjectId(id);
    },
    [setActiveProjectId],
  );

  return (
    <aside className="no-select flex h-full w-56 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Project Selector */}
      <div className="border-b border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent">
            <div className="flex size-6 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
              {activeProject?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="flex-1 truncate text-left text-sidebar-foreground">
              {activeProject?.name ?? "Select project"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleProjectSwitch(p.id)}
                className={cn(p.id === activeProjectId && "bg-accent")}
              >
                <div className="flex size-5 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
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
      {activeProjectId && (
        <SidebarTree
          projectId={activeProjectId}
          onNewJobForGoal={onNewJobForGoal}
        />
      )}

      {/* Settings at bottom */}
      <div className="border-t border-sidebar-border p-2">
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
