/**
 * Custom hook for drag-to-nest behavior in the sidebar goal tree.
 * Tracks horizontal drag offset to distinguish "reorder" from "nest/unnest".
 */

import { useState, useRef, useCallback } from "react";
import { canNestUnder } from "@/lib/goal-tree";
import type { Goal } from "@openhelm/shared";
import type { DragMoveEvent, DragStartEvent, DragEndEvent } from "@dnd-kit/core";

export type DragIntent = "reorder" | "nest" | "unnest";

const NEST_THRESHOLD_PX = 25;

interface UseGoalDragNestOptions {
  goals: Goal[];
  onNest: (goalId: string, newParentId: string) => void;
  onUnnest: (goalId: string, currentParentId: string) => void;
  onReorder: (event: DragEndEvent) => void;
}

export function useGoalDragNest({ goals, onNest, onUnnest, onReorder }: UseGoalDragNestOptions) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  const [dragIntent, setDragIntent] = useState<DragIntent>("reorder");
  const activeIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setIsDragActive(true);
    activeIdRef.current = event.active.id as string;
    setDragIntent("reorder");
    setNestTarget(null);
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const deltaX = event.delta.x;
    const activeId = activeIdRef.current;
    if (!activeId) return;

    if (deltaX > NEST_THRESHOLD_PX && event.over) {
      const overId = event.over.id as string;
      const overGoal = goals.find((g) => g.id === overId);
      if (overGoal && canNestUnder(activeId, overId, goals)) {
        setDragIntent("nest");
        setNestTarget(overId);
        return;
      }
    }

    if (deltaX < -NEST_THRESHOLD_PX) {
      const activeGoal = goals.find((g) => g.id === activeId);
      if (activeGoal?.parentId) {
        setDragIntent("unnest");
        setNestTarget(null);
        return;
      }
    }

    if (Math.abs(deltaX) <= NEST_THRESHOLD_PX / 2) {
      setDragIntent("reorder");
      setNestTarget(null);
    }
  }, [goals]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const activeId = activeIdRef.current;
    setIsDragActive(false);

    if (activeId && dragIntent === "nest" && nestTarget) {
      onNest(activeId, nestTarget);
    } else if (activeId && dragIntent === "unnest") {
      const goal = goals.find((g) => g.id === activeId);
      if (goal?.parentId) {
        onUnnest(activeId, goal.parentId);
      }
    } else {
      onReorder(event);
    }

    setDragIntent("reorder");
    setNestTarget(null);
    activeIdRef.current = null;
  }, [dragIntent, nestTarget, goals, onNest, onUnnest, onReorder]);

  const handleDragCancel = useCallback(() => {
    setIsDragActive(false);
    setDragIntent("reorder");
    setNestTarget(null);
    activeIdRef.current = null;
  }, []);

  return {
    isDragActive,
    nestTarget,
    dragIntent,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
