/**
 * Right-click context menu for goal nodes — offers hierarchy management actions.
 */

import { type ReactNode } from "react";
import { Archive, Briefcase, Flag, MoveUp, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Goal } from "@openhelm/shared";

interface SidebarGoalContextMenuProps {
  goal: Goal;
  children: ReactNode;
  onNewSubGoal: () => void;
  onNewJob: () => void;
  onMoveToRoot: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function SidebarGoalContextMenu({
  goal,
  children,
  onNewSubGoal,
  onNewJob,
  onMoveToRoot,
  onArchive,
  onDelete,
}: SidebarGoalContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onNewSubGoal}>
          <Flag className="mr-2 size-3.5" />
          Add Sub-Goal
        </ContextMenuItem>
        <ContextMenuItem onClick={onNewJob}>
          <Briefcase className="mr-2 size-3.5" />
          Add Job
        </ContextMenuItem>
        {goal.parentId && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onMoveToRoot}>
              <MoveUp className="mr-2 size-3.5" />
              Move to Root
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onArchive}>
          <Archive className="mr-2 size-3.5" />
          Archive
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive">
          <Trash2 className="mr-2 size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
