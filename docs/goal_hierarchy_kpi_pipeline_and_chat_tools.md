# Plan 9 Implementation Summary
## Goal Hierarchy, Chat Tools for Targets/Visualizations, Approval Reliability & KPI Workflow Teaching

**Date:** April 2026  
**Status:** Complete

---

## Overview

This document records all work carried out in the Plan 9 session. It addresses 5 UX issues discovered from real usage of OpenHelm, plus a follow-up to improve how the AI understands the relationship between goals, targets, data tables, visualizations, and jobs (the "KPI tracking pipeline").

---

## Issues Addressed

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Goals are flat — no parent/child nesting | No `parent_id` column in DB, no UI to nest | DB migration + tree rendering + drag-to-nest + context menu |
| 2 | Approve/reject buttons don't always appear | LLM describes actions in text without emitting `<tool_call>` XML | Stronger system prompt rule + fallback nudge retry in handler |
| 3 | AI couldn't create targets via chat | `create_target` only existed as an MCP tool for jobs, not in chat tools | New `target-chat-tools.ts` wired into chat tool registry |
| 4 | AI couldn't create visualizations via chat | Same gap as #3 | New `visualization-chat-tools.ts` wired into chat tool registry |
| 5 | Dashboard insights flat — doesn't reflect hierarchy | Insights section rendered targets grouped by flat goal list | Recursive `GoalTargetGroup` component with depth indentation |
| 6 | AI didn't understand KPI tracking pipeline | System prompt described entities individually, no workflow example | Added "KPI Tracking Workflow" section + 5-step example to prompt |

---

## Part A: Goal Hierarchy

### A1 — Database layer

**New file:** `agent/src/db/migrations/0031_add_goal_hierarchy.sql`

```sql
ALTER TABLE goals ADD COLUMN parent_id TEXT REFERENCES goals(id) ON DELETE CASCADE;
CREATE INDEX idx_goals_parent_id ON goals(parent_id);
```

`ON DELETE CASCADE` means deleting a parent silently removes all descendants at the DB level. The frontend captures a snapshot before deletion and offers an 8-second undo toast that re-inserts the entire subtree.

**Modified:** `agent/src/db/schema.ts` — added `parentId` column with self-referential FK.

**Modified:** `agent/src/db/migrations-data.ts` — registered migration at index 31.

### A2 — Shared types

**Modified:** `shared/src/index.ts`

- `Goal` interface: added `parentId: string | null`
- `CreateGoalParams`: added `parentId?: string`
- `UpdateGoalParams`: added `parentId?: string | null` (null = promote to root)
- New type `GoalTreeNode extends Goal { children: GoalTreeNode[]; depth: number }` — used by sidebar for recursive rendering
- New type `GoalDeleteSnapshot { goals: Goal[]; jobIds: string[] }` — used by undo toast

### A3 — Hierarchy query helpers

**New file:** `agent/src/db/queries/goal-hierarchy.ts`

| Function | Purpose |
|----------|---------|
| `getGoalAncestors(goalId)` | Walks `parentId` chain upward, returns ordered ancestor list |
| `getGoalChildren(goalId)` | Returns direct children ordered by `sortOrder` |
| `getGoalDescendants(goalId)` | Recursively returns all descendants |
| `isDescendantOf(goalId, ancestorId)` | Circular reference check for drag-to-nest |
| `getGoalDeleteSnapshot(goalId)` | Collects goals + job IDs before cascade delete |
| `restoreGoalDeleteSnapshot(snapshot)` | Re-inserts goals and job links for undo |

### A4 — Goal queries updated

**Modified:** `agent/src/db/queries/goals.ts`

- `createGoal`: `sortOrder` now scoped to siblings with same `parentId`; inserts `parentId`
- `updateGoal`: validates no circular refs via `isDescendantOf()` when reparenting; cascades archive status to all descendants

### A5 — IPC handlers

**Modified:** `agent/src/ipc/handlers/goals.ts`

- `goals.delete`: collects snapshot before deletion, returns it to frontend
- Added handlers: `goals.children`, `goals.ancestors`, `goals.restoreDeleted`

### A6 — Frontend API

**Modified:** `src/lib/api.ts`

- `deleteGoal` return type updated: `{ deleted: boolean; snapshot: GoalDeleteSnapshot }`
- Added: `getGoalChildren`, `getGoalAncestors`, `restoreDeletedGoal`

### A7 — Goal tree utilities

**New file:** `src/lib/goal-tree.ts`

- `buildGoalTree(goals)` — converts flat `Goal[]` to `GoalTreeNode[]` tree via `parentId` links
- `flattenGoalTree(nodes)` — DFS flatten for `SortableContext`
- `canNestUnder(draggedId, targetId, allGoals)` — prevents nesting a goal under its own descendant

### A8 — Drag-to-nest hook

**New file:** `src/hooks/use-goal-drag-nest.ts`

Extends dnd-kit drag with horizontal offset detection:
- `NEST_THRESHOLD_PX = 25` — `delta.x > 25` triggers nest intent, `delta.x < -25` triggers unnest intent
- Returns `dragIntent: "reorder" | "nest" | "unnest"` and `nestTarget` (ID of hover target for highlight)
- Handlers: `handleDragStart`, `handleDragMove`, `handleDragEnd`, `handleDragCancel`

### A9 — Sidebar UI components

**New file:** `src/components/layout/sidebar-goal-add-menu.tsx`  
DropdownMenu on the plus button with two items: "Sub-Goal" and "Job".

**New file:** `src/components/layout/sidebar-goal-context-menu.tsx`  
Right-click ContextMenu wrapping each goal node. Items: Add Sub-Goal, Add Job, Move to Root (when nested), Archive, Delete.

**Rewritten:** `src/components/layout/sidebar-goal-node.tsx`
- Now accepts `GoalTreeNode` (not `Goal`) — has `children` and `depth`
- Depth-based indentation: `paddingLeft: depth * 16px`
- Recursive child rendering
- Replaced raw Plus button with `SidebarGoalAddMenu`
- Wrapped in `SidebarGoalContextMenu`
- Nest target highlight: `ring-2 ring-primary/50` when this goal is the drag hover target

**Modified:** `src/components/layout/sidebar-job-node.tsx`  
Added `indentLevel?: number` prop for aligned job indentation under nested goals.

**Modified:** `src/components/layout/sidebar-tree.tsx`
- Added `buildGoalTree` import and `goalTree` memo
- Added callbacks: `handleMoveToRoot`, `handleNestGoal`, `handleUnnestGoal`
- Root nodes only passed to `SidebarGoalNode`; children render recursively

**Modified:** `src/components/layout/sidebar-project-group.tsx`
- Added `buildGoalTree` import and `goalTree` memo to produce `GoalTreeNode[]`

### A10 — Goal detail view enhancements

**New file:** `src/components/goals/goal-breadcrumb.tsx`  
Walks `parentId` chain using goals from Zustand store. Renders clickable ancestor links: `Root > Parent > Current`.

**New file:** `src/components/goals/goal-sub-goals-section.tsx`  
Shows child goals of the currently viewed goal. Displays job count and status badge per sub-goal. Includes Add Sub-Goal button.

**Modified:** `src/components/content/goal-detail-view.tsx`
- Added `GoalBreadcrumb` above title (shown when `goal.parentId` is set)
- Added `GoalSubGoalsSection` in the detail body

**Modified:** `src/components/goals/goal-creation-sheet.tsx`
- Added `parentGoalId?: string` prop
- Passes `parentId: parentGoalId` to `createGoal()`
- Sheet title changes to "Create Sub-Goal" when parent is set

### A11 — Dashboard insights: hierarchical grouping

**Modified:** `src/components/content/dashboard-insights-section.tsx`

`GoalTargetGroup` refactored to be recursive:
- Accepts `goal`, `allGoals`, `targetsByGoal`, `depth`
- Shows only root goals (`parentId === null`) at top level
- Each goal renders its sub-goals recursively with `paddingLeft: depth * 12px`
- Skips goals (and subtrees) with no targets

### A12 — Autopilot system-job generation: hierarchy context

**Modified:** `agent/src/planner/system-jobs.ts`
- Added `buildHierarchyContext(goalId)` — injects parent and sub-goal names into the LLM generation prompt so generated system jobs are aware of the broader goal structure

---

## Part B: Chat Tools for Targets & Visualizations

### B1 — Target chat tools

**New file:** `agent/src/chat/target-chat-tools.ts`

Five tools registered under `TARGET_CHAT_TOOLS`:

| Tool | Type | Description |
|------|------|-------------|
| `list_targets` | Read | List targets by goal/job/project |
| `evaluate_targets` | Read | Return current values, progress %, and met status |
| `create_target` | Write | Create KPI target linked to a data table column |
| `update_target` | Write | Update value, direction, aggregation, label, deadline |
| `delete_target` | Write | Delete a target |

**Key design: column name resolution.** The AI passes human-readable `tableName` and `columnName`. The tool calls `listDataTables({ projectId })` to find the table by name, then resolves the column by name — matching the MCP pattern. This avoids the AI needing to know internal IDs.

Exports: `TARGET_CHAT_TOOLS`, `describeTargetAction()`, `executeTargetReadTool()`, `executeTargetWriteTool()`

### B2 — Visualization chat tools

**New file:** `agent/src/chat/visualization-chat-tools.ts`

Four tools registered under `VISUALIZATION_CHAT_TOOLS`:

| Tool | Type | Description |
|------|------|-------------|
| `list_visualizations` | Read | List charts by goal/job/data table |
| `create_visualization` | Write | Create chart from data table columns |
| `update_visualization` | Write | Update name or chart type |
| `delete_visualization` | Write | Delete a chart |

**Chart config building:** `create_visualization` accepts column names and builds the correct `VisualizationConfig` per chart type:
- `line/bar/area` → `xColumnId + series[]`
- `pie` → `valueColumnId + labelColumnId`
- `stat` → `statColumnId + statAggregation`

### B3 — Tool registry wiring

**Modified:** `agent/src/chat/tools.ts`
- Imported `TARGET_CHAT_TOOLS`, `VISUALIZATION_CHAT_TOOLS`
- Spread both into `TOOLS` array after `DATA_TABLE_TOOLS`
- Added `parentGoalId` parameter to `create_goal` tool definition
- Extended `describeAction()` to check target and visualization tools

**Modified:** `agent/src/chat/tool-executor.ts`
- Imported and delegated to `executeTargetReadTool`, `executeTargetWriteTool`, `executeVisualizationReadTool`, `executeVisualizationWriteTool`
- Added `create_target`, `create_visualization` to project-scoped guard (rejected for "All Projects" threads)
- `create_goal` case: passes `parentId: a.parentGoalId`

**Modified:** `agent/src/chat/action-handler.ts`
- Extended `linkableTools` from `["create_job"]` to `["create_job", "create_target", "create_visualization"]` — all three now support `goalId: "pending"` auto-linking
- Updated `handleApproveAll` execution order: `create_goal` (priority 0) → `create_data_table` (priority 1) → everything else (priority 2), ensuring the data table exists before targets/visualizations reference it

---

## Part C: Approval Button Reliability

### C1 — Stronger system prompt rule

**Modified:** `agent/src/chat/system-prompt.ts`

Added to Rules section:
> NEVER describe what you "would" or "will" create — if the user asks you to create, update, or delete anything, you MUST include the actual `<tool_call>` XML blocks in your response. The UI only shows approve/reject buttons when tool_call blocks are present. Text descriptions of actions are not actionable.

### C2 — Fallback nudge in handler

**Modified:** `agent/src/chat/handler.ts`

After the tool loop completes (all tool calls executed), if the final LLM response:
1. Contains no `<tool_call>` blocks, AND
2. Matches a creation-intent regex: `/\b(creat|set up|add|configur|defin)\w*\b.{0,50}\b(goal|job|target|visualization|data table|chart|memory)\b/i`

Then a single retry is sent with a nudge prompt:
> "You described actions but didn't include `<tool_call>` XML blocks. Please resend with the actual tool calls so the user can approve them."

This handles cases where the model plans in text before producing tool calls — the nudge triggers one more LLM call to get the actual XML.

### C3 — Diagnostic logging

**Modified:** `agent/src/chat/handler.ts`

Logs `[chat:handler] response has no tool calls — may be text-only response or missed tool call` when a response with apparent creation intent produces no tool calls. Aids debugging in future sessions.

---

## Part D: KPI Workflow Teaching

### D1 — Updated entity descriptions

**Modified:** `agent/src/chat/system-prompt.ts` (system intro section)

Added Targets and Visualizations to the entity list:
- **Targets**: numerical KPI targets linked to data table columns (e.g. "DAU >= 50 by Apr 3")
- **Visualizations**: charts (line, bar, area, pie, stat) built from data table columns

### D2 — KPI Tracking Workflow section

Added an explicit 5-step workflow section to the system prompt:

```
## KPI Tracking Workflow

When a user wants to track a metric or KPI:
1. Goal     — the high-level objective
2. Data Table — stores the metric data
3. Job      — scheduled task that collects data into the table
4. Target   — numerical KPI linked to a specific column
5. Visualization — chart that renders the data table
```

The data table MUST exist before targets or visualizations can reference it — this ordering constraint is called out explicitly.

### D3 — End-to-end example

A complete 5-tool example was added to the system prompt showing all five tool calls in a single response:

```xml
create_goal → create_data_table → create_job → create_target → create_visualization
```

Demonstrates: `goalId: "pending"` on jobs/targets/visualizations, `tableName` references (not IDs), and proper column naming.

### D4 — Updated rules for KPI workflows

New rules added to `buildRulesSection()`:

- "When the user mentions KPIs, metrics, thresholds, or numerical targets, use the FULL KPI workflow: goal + data table + job + target + visualization. NEVER embed target info in goal descriptions."
- "Before creating targets or visualizations, call list_data_tables. If a suitable table exists, reuse it."
- "When creating a data table for KPI tracking, design columns that the scheduled job can populate."
- "After creating a target, also create a visualization for the same data table so the user can see progress visually."
- "Targets require a data table column. If no relevant data table exists, create the data table first, then the target."
- "Goals support hierarchy (sub-goals). Use parentGoalId with create_goal to create sub-goals."

### D5 — Tool description updates

- `create_target` description updated: "The data table MUST exist first (create it with create_data_table if needed)."
- `create_visualization` description updated: "The data table MUST exist first."
- `create_goal` description updated: mentions `parentGoalId` for sub-goal creation.

---

## Files Changed

### New files (13)
| File | Purpose |
|------|---------|
| `agent/src/db/migrations/0031_add_goal_hierarchy.sql` | DB migration for `parent_id` |
| `agent/src/db/queries/goal-hierarchy.ts` | Hierarchy query helpers |
| `agent/src/chat/target-chat-tools.ts` | Target tools for chat sidebar |
| `agent/src/chat/visualization-chat-tools.ts` | Visualization tools for chat sidebar |
| `src/lib/goal-tree.ts` | Tree building and flatten utilities |
| `src/hooks/use-goal-drag-nest.ts` | Drag-to-nest hook |
| `src/components/layout/sidebar-goal-add-menu.tsx` | Plus button dropdown |
| `src/components/layout/sidebar-goal-context-menu.tsx` | Right-click context menu |
| `src/components/goals/goal-breadcrumb.tsx` | Ancestor breadcrumb navigation |
| `src/components/goals/goal-sub-goals-section.tsx` | Sub-goals list on goal detail |
| `docs/plan_9_goal_hierarchy_and_chat_tools.md` | Architectural plan (written in plan mode) |
| `docs/plan_9_implementation_summary.md` | This document |

### Modified files (17)
| File | Change |
|------|--------|
| `shared/src/index.ts` | `parentId`, `GoalTreeNode`, `GoalDeleteSnapshot` types |
| `agent/src/db/schema.ts` | `parentId` column |
| `agent/src/db/migrations-data.ts` | Migration 0031 registered |
| `agent/src/db/queries/goals.ts` | `parentId` support, circular ref guard, cascade archive |
| `agent/src/ipc/handlers/goals.ts` | Snapshot on delete, hierarchy handlers |
| `agent/src/chat/tools.ts` | Target + viz tools added, `parentGoalId` on create_goal |
| `agent/src/chat/tool-executor.ts` | Delegation to target/viz executors |
| `agent/src/chat/action-handler.ts` | `linkableTools` extended, priority sort |
| `agent/src/chat/system-prompt.ts` | KPI workflow, example, entity descriptions, rules |
| `agent/src/chat/handler.ts` | Fallback nudge, diagnostic logging |
| `agent/src/planner/system-jobs.ts` | Hierarchy context in generation prompt |
| `src/lib/api.ts` | `deleteGoal` snapshot return, hierarchy API calls |
| `src/components/layout/sidebar-goal-node.tsx` | GoalTreeNode, depth indent, recursive children |
| `src/components/layout/sidebar-job-node.tsx` | `indentLevel` prop |
| `src/components/layout/sidebar-tree.tsx` | Tree rendering, nest/unnest callbacks |
| `src/components/layout/sidebar-project-group.tsx` | `GoalTreeNode[]` from `buildGoalTree` |
| `src/components/content/goal-detail-view.tsx` | Breadcrumb + sub-goals section |
| `src/components/goals/goal-creation-sheet.tsx` | `parentGoalId` prop |
| `src/components/content/dashboard-insights-section.tsx` | Recursive `GoalTargetGroup` |

---

## Design Decisions

### Unlimited nesting depth
No artificial cap at 2 or 3 levels. The DB schema and UI support arbitrary depth. The sidebar indents 16px per level; breadcrumbs show the full ancestry chain.

### Cascade delete + undo toast
When a parent goal is deleted, all descendants are removed by `ON DELETE CASCADE` at the DB level. Before deletion, the frontend captures a `GoalDeleteSnapshot` (all goals in the subtree + their job IDs). An 8-second undo toast calls `restoreDeletedGoal(snapshot)` to re-insert everything.

### Both drag and context menu for nesting
Power users can drag horizontally past the 25px threshold to nest/unnest. Discoverability users can right-click for the context menu. Both paths call the same `updateGoal({ parentId })` logic.

### Column resolution by name (not ID)
Chat tools accept `tableName` and `columnName` as strings. The tool implementation calls `listDataTables()` and matches by name (case-insensitive). This lets the AI refer to "PostHog Usage Metrics" and "DAU" naturally without knowing internal UUIDs.

### "pending" goalId auto-linking
Jobs, targets, and visualizations created in the same AI response can use `goalId: "pending"`. The `action-handler.ts` sorts `create_goal` first, captures its returned ID, then replaces `"pending"` in all subsequent tool calls before execution. This allows a full KPI pipeline to be proposed and approved atomically in one interaction.

### Execution order on approval
`handleApproveAll` sorts pending actions: `create_goal` → `create_data_table` → everything else. This guarantees the data table exists by the time targets and visualizations try to look up column IDs.
