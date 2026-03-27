import { useCallback, useState } from "react";
import logoSvg from "@/assets/logo.svg";
import { Settings, ChevronDown, Plus, LayoutDashboard, Layers, Waypoints, KeyRound, Pencil, MessageSquare, Star, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { GitHubStarDialog, getStarBannerVisible } from "@/components/shared/github-star-dialog";
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
import { useDashboardStore } from "@/stores/dashboard-store";
import { useMemoryStore } from "@/stores/memory-store";
import { useCredentialStore } from "@/stores/credential-store";
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
  const { openCount } = useDashboardStore();
  const { memoryCount } = useMemoryStore();
  const { credentialCount } = useCredentialStore();

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [starDialogOpen, setStarDialogOpen] = useState(false);
  const [starBannerVisible, setStarBannerVisible] = useState(() => getStarBannerVisible());
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleProjectSwitch = useCallback(
    (id: string | null) => {
      setActiveProjectId(id);
    },
    [setActiveProjectId],
  );

  return (
    <aside className="no-select flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo row — h-12 header; click-to-drag via Tauri IPC */}
      <div
        data-tauri-drag-region
        onMouseDown={() => { getCurrentWindow().startDragging(); }}
        className="flex h-12 shrink-0 items-center border-b border-sidebar-border pl-[96px] pr-4"
      >
        <img src={logoSvg} alt="OpenHelm" className="pointer-events-none size-6" />
        <h1 className="pointer-events-none ml-1.5 text-sm font-semibold tracking-tight text-white">OpenHelm</h1>
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

      {/* Dashboard + Memory */}
      <div className="border-b border-sidebar-border px-2 py-2 space-y-0.5">
        <button
          onClick={() => setContentView("dashboard")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            contentView === "dashboard"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <LayoutDashboard className="size-4" />
          <span className="flex-1 text-left">Dashboard</span>
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

        <button
          onClick={() => setContentView("credentials")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            contentView === "credentials"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <KeyRound className="size-4" />
          <span className="flex-1 text-left">Credentials</span>
          {credentialCount > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">
              {credentialCount}
            </span>
          )}
        </button>
      </div>

      {/* Tree Navigation */}
      <SidebarTree
        projectId={activeProjectId}
        onNewJobForGoal={onNewJobForGoal}
      />

      {/* Feedback + Settings at bottom */}
      <div className="mt-auto border-t border-sidebar-border p-2 space-y-0.5">
        {starBannerVisible && (
          <div className="flex items-center rounded-md hover:bg-sidebar-accent/50 transition-colors group">
            <button
              onClick={() => openUrl("https://github.com/maxbeech/openhelm")}
              className="flex flex-1 items-center gap-2.5 px-2.5 py-1.5 text-sm text-muted-foreground group-hover:text-sidebar-foreground"
            >
              <Star className="size-4" />
              <span>Star on GitHub</span>
            </button>
            <button
              onClick={() => setStarDialogOpen(true)}
              className="mr-1.5 flex size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground transition-colors"
              title="Dismiss"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <GitHubStarDialog
          open={starDialogOpen}
          onOpenChange={setStarDialogOpen}
          onDismiss={() => setStarBannerVisible(false)}
        />
        <button
          onClick={() => setFeedbackOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm
                     text-muted-foreground transition-colors
                     hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <MessageSquare
            className="size-4 [&_path]:[animation:feedback-icon-pulse_6s_ease-in-out_infinite]"
          />
          <span>Feedback</span>
        </button>
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
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
