/**
 * Plus icon dropdown for goal nodes — offers "Sub-Goal" and "Job" creation options.
 */

import { Briefcase, Flag, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SidebarGoalAddMenuProps {
  onNewSubGoal: () => void;
  onNewJob: () => void;
}

export function SidebarGoalAddMenu({ onNewSubGoal, onNewJob }: SidebarGoalAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
          title="Add sub-goal or job"
        >
          <Plus className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem onClick={onNewSubGoal}>
          <Flag className="mr-2 size-3.5" />
          Sub-Goal
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewJob}>
          <Briefcase className="mr-2 size-3.5" />
          Job
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
