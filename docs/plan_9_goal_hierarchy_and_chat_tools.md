# Plan 9: Goal Hierarchy, Chat Tools for Targets/Visualizations, and Approval Reliability

## Context

OpenHelm has goals, targets (plan 7), and visualizations (plan 8), but three UX gaps emerged from real usage:

1. **Goals are flat** — no parent/child hierarchy. A user wanting "Increase User Base" with sub-goals "Grow DAUs" and "Improve Retention" can't express this relationship.
2. **Chat AI can't create targets or visualizations** — these tools exist only as MCP server tools (for jobs), not as chat sidebar tools. When a user asks the AI to create KPI targets, it writes them into the goal description text instead.
3. **Approve/reject buttons don't always appear** — the LLM sometimes describes what it would create without emitting the `<tool_call>` XML blocks that trigger the approval UI.
4. **Dashboard insights don't reflect hierarchy** — the insights section groups targets by goal (flat), but should reflect parent/child goal relationships.

---

## Part A: Goal Hierarchy

### A1. Data Model

**New migration: `agent/src/db/migrations/0031_add_goal_hierarchy.sql`**

```sql
ALTER TABLE goals ADD COLUMN parent_id TEXT REFERENCES goals(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_goals_parent_id ON goals(parent_id);
```

`ON DELETE CASCADE` — deleting a parent goal deletes all descendants. The frontend implements an undo toast that holds a snapshot and re-inserts on undo (see A6).

No depth cap enforced in the DB — unlimited nesting supported.

**Register in `agent/src/db/migrations-data.ts`**: idx 31, tag `0031_add_goal_hierarchy`.

**Modify `agent/src/db/schema.ts`**: Add `parentId` column to goals table:
```typescript
parentId: text("parent_id").references((): AnySQLiteColumn => goals.id, { onDelete: "cascade" }),
```

### A2. Shared Types

**Modify `shared/src/index.ts`**:

```typescript
// Add to Goal interface:
parentId: string | null;

// Add to CreateGoalParams:
parentId?: string;

// Add to UpdateGoalParams:
parentId?: string | null;  // null = promote to root

// New type for tree rendering:
export interface GoalTreeNode extends Goal {
  children: GoalTreeNode[];
  depth: number;
}

// New type for undo snapshot:
export interface GoalDeleteSnapshot {
  goals: Goal[];
  jobs: Job[];
  targets: Target[];
  visualizations: Visualization[];
}
```

### A3. Query Layer

**Modify `agent/src/db/queries/goals.ts`**:

- `createGoal(params)` — accept and persist `parentId`; sort order scoped to siblings (goals sharing the same parentId)
- `updateGoal(params)` — handle `parentId` changes; validate no circular references (a goal cannot be nested under its own descendant)
- `deleteGoal(id)` — CASCADE handles children via DB constraint; before deletion, collect full snapshot for undo

**New file: `agent/src/db/queries/goal-hierarchy.ts`** (~80 lines):

- `getGoalDepth(goalId)` — walks parentId chain, returns depth (0 = root)
- `getGoalAncestors(goalId)` — returns array from immediate parent to root
- `getGoalChildren(goalId)` — direct children, ordered by sortOrder
- `getGoalDescendants(goalId)` — recursive, all descendants
- `getGoalDeleteSnapshot(goalId)` — collects goals, jobs, targets, visualizations for undo
- `restoreGoalDeleteSnapshot(snapshot)` — re-inserts all items with original IDs
- `isDescendantOf(goalId, potentialAncestorId)` — circular reference check

### A4. IPC Handlers

**Modify `agent/src/ipc/handlers/goals.ts`**:

- `goals.create` — parentId flows through (already passes full params to query)
- `goals.update` — parentId flows through; add circular reference validation
- `goals.delete` — before delete, call `getGoalDeleteSnapshot()`, return snapshot in response; emit `goals.deleted` with snapshot so frontend can offer undo
- New handler: `goals.children` — returns direct children of a goal
- New handler: `goals.ancestors` — returns ancestor chain
- New handler: `goals.restoreDeleted` — accepts `GoalDeleteSnapshot`, re-inserts all items (called by undo toast)

### A5. Sidebar UX — Drag-to-Nest + Plus Dropdown + Context Menu

**New file: `src/lib/goal-tree.ts`** (~60 lines) — Pure utility:
- `buildGoalTree(goals: Goal[]): GoalTreeNode[]` — converts flat array to tree
- `flattenGoalTree(nodes: GoalTreeNode[]): GoalTreeNode[]` — DFS flatten for SortableContext
- `canNestUnder(draggedId, targetId, allGoals)` — validates no circular nesting

**New file: `src/hooks/use-goal-drag-nest.ts`** (~80 lines) — Custom hook encapsulating drag-to-nest state:
- Tracks `dragIntent: "reorder" | "nest" | "unnest"` based on horizontal drag offset
- `nestTarget: string | null` — goal ID being hovered as nest target
- Threshold: 25px horizontal drag = nest mode; -25px = unnest mode
- Returns: `handleDragStart`, `handleDragMove`, `handleDragEnd`, `nestTarget`, `dragIntent`

**New file: `src/components/layout/sidebar-goal-add-menu.tsx`** (~50 lines):
- DropdownMenu on the Plus icon with two options:
  - "Sub-Goal" (creates a child goal under this goal)
  - "Job" (creates a job, existing behavior)
- Uses shadcn/ui `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`

**New file: `src/components/layout/sidebar-goal-context-menu.tsx`** (~60 lines):
- Right-click context menu on goal nodes with options:
  - "Add Sub-Goal"
  - "Add Job"
  - "Move to..." → submenu listing other goals as potential parents
  - "Move to root" (if goal has a parent)
  - Separator
  - "Archive"
  - "Delete"

**Modify `src/components/layout/sidebar-goal-node.tsx`**:
- Accept new props: `childGoals: GoalTreeNode[]`, `depth: number`, `nestTargetId: string | null`, `onNewSubGoal`
- Indentation: `paddingLeft: depth * 16px` per nesting level
- Replace Plus button with `<SidebarGoalAddMenu>`
- Wrap goal row in `<SidebarGoalContextMenu>`
- Render child goals recursively between goal header and jobs list
- Nest target highlight: ring border when `nestTargetId === goal.id`

**Modify `src/components/layout/sidebar-tree.tsx`**:
- Use `buildGoalTree()` to convert flat goals array to tree
- Use `useGoalDragNest` hook for drag-to-nest behavior
- Pass `nestTarget` through to goal nodes
- On nest: call `api.updateGoal({ id, parentId: targetId })`
- On unnest: call `api.updateGoal({ id, parentId: grandparentId ?? null })`
- Drag visual feedback: `DragOverlay` shows the goal node with a "nesting" indicator

### A6. Undo Toast for Cascade Delete

**Modify `src/stores/goal-store.ts`**:
- `deleteGoal` → calls API, receives snapshot, shows toast with "Undo" button
- Undo handler calls `api.restoreDeletedGoal(snapshot)` → re-inserts everything
- Toast auto-dismisses after 8 seconds (standard undo window)

Implementation pattern (using sonner toast or shadcn/ui toast already in the project):
```typescript
deleteGoal: async (id) => {
  const { snapshot } = await api.deleteGoal(id);
  // Optimistic: remove from store
  set((s) => ({ goals: s.goals.filter(g => !snapshot.goals.some(sg => sg.id === g.id)) }));
  // Show undo toast
  toast("Goal deleted", {
    description: `${snapshot.goals.length} goal(s) and ${snapshot.jobs.length} job(s) removed`,
    action: { label: "Undo", onClick: () => api.restoreDeletedGoal(snapshot).then(() => fetchGoals()) },
    duration: 8000,
  });
}
```

### A7. Goal Detail View

**New file: `src/components/goals/goal-breadcrumb.tsx`** (~40 lines):
- Renders: "Parent Goal > Child Goal > Current Goal" with clickable ancestor links
- Walks `parentId` chain using goals from store (no API call needed)

**New file: `src/components/goals/goal-sub-goals-section.tsx`** (~80 lines):
- Lists child goals of the current goal in a table: Name, Status, Target count, Jobs count
- "Add Sub-Goal" button opens goal creation sheet with `parentGoalId` pre-set
- Clicking a row navigates to that sub-goal's detail view

**Modify `src/components/content/goal-detail-view.tsx`**:
- Add breadcrumb at top when `goal.parentId` is set
- Add sub-goals section between targets and jobs sections

**Modify `src/components/goals/goal-creation-sheet.tsx`**:
- Accept optional `parentGoalId` prop
- Pass through as `parentId` in `createGoal()` call
- Show read-only "Parent Goal" field and update title to "Create Sub-Goal" when parent is set

### A8. Dashboard Insights — Hierarchical Grouping

**Modify `src/components/content/dashboard-insights-section.tsx`**:
- Replace flat goal→target rendering with recursive `GoalTargetGroup`
- Only render root goals (parentId=null); children render recursively with indentation
- Each nested goal shows its own targets with increasing left padding
- Charts section similarly groups by goal hierarchy

### A9. Chat Integration

**Modify `agent/src/chat/tools.ts`**:
- Add `parentGoalId` parameter to `create_goal` tool definition

**Modify `agent/src/chat/tool-executor.ts`**:
- Pass `parentId: a.parentGoalId` in `createGoal()` call

**Modify `agent/src/chat/system-prompt.ts`**:
- Mention sub-goals: "Goals support hierarchy. Use parentGoalId to create a sub-goal under an existing goal."

### A10. Autopilot

The existing autopilot `generateAndHandleSystemJobs(goalId, projectId)` works unchanged for sub-goals — it generates system jobs scoped to whichever goal is passed. No modification needed.

**Modify `agent/src/planner/system-jobs.ts`**:
- In `buildUserMessage()`, include parent goal context so the LLM knows about the broader initiative
- Include child goal targets alongside the goal's own targets

---

## Part B: Chat Tools for Targets and Visualizations

### B1. New File: `agent/src/chat/target-chat-tools.ts` (~180 lines)

Following the `data-table-tools.ts` pattern exactly:

**Read tools** (auto-execute):
- `list_targets` — params: `goalId?`, `jobId?`. Lists targets with current values.
- `evaluate_targets` — params: `goalId?`, `jobId?`. Returns progress, met status, isOverdue.

**Write tools** (require confirmation):
- `create_target` — params: `goalId?` (supports "pending" for goal linking), `tableName` (required), `columnName` (required), `targetValue` (required), `direction?` (gte/lte/eq, default gte), `aggregation?` (latest/sum/avg/max/min/count, default latest), `label?`, `deadline?`
- `update_target` — params: `targetId`, `targetValue?`, `direction?`, `aggregation?`, `label?`, `deadline?`
- `delete_target` — params: `targetId`

**Column resolution** (critical): `tableName` and `columnName` resolve to IDs by looking up the project's data tables, matching the pattern in `agent/src/mcp-servers/data-tables/target-tools.ts:143-165`.

**Exported**: `TARGET_CHAT_TOOLS`, `describeTargetAction()`, `executeTargetReadTool()`, `executeTargetWriteTool()`

### B2. New File: `agent/src/chat/visualization-chat-tools.ts` (~200 lines)

**Read tools**:
- `list_visualizations` — params: `goalId?`, `jobId?`, `dataTableId?`

**Write tools**:
- `create_visualization` — params: `tableName` (required), `name` (required), `chartType` (required: line/bar/area/pie/stat), `xColumnName?`, `yColumnNames?` (comma-separated), `valueColumnName?`, `labelColumnName?`, `aggregation?`, `goalId?`
- `update_visualization` — params: `id`, `name?`, `chartType?`
- `delete_visualization` — params: `id`

**Column resolution**: Same pattern — resolve table/column names to IDs.

**Exported**: `VISUALIZATION_CHAT_TOOLS`, `describeVisualizationAction()`, `executeVisualizationReadTool()`, `executeVisualizationWriteTool()`

### B3. Wire Into Existing Chat Infrastructure

**Modify `agent/src/chat/tools.ts`**:
- Import and spread `TARGET_CHAT_TOOLS` and `VISUALIZATION_CHAT_TOOLS` into `TOOLS` array
- Extend `describeAction()` to check target and visualization tools

**Modify `agent/src/chat/tool-executor.ts`**:
- In `executeReadTool()`: delegate to `executeTargetReadTool()` and `executeVisualizationReadTool()` after data table delegation
- In `executeWriteTool()`: delegate to `executeTargetWriteTool()` and `executeVisualizationWriteTool()`; add `create_target` and `create_visualization` to the project-scoped guard

**Modify `agent/src/chat/action-handler.ts`**:
- In the pending goal FK-linking logic: also handle `create_target` and `create_visualization` with `goalId: "pending"` — link to the most recently created goal ID

### B4. System Prompt Updates

**Modify `agent/src/chat/system-prompt.ts`**:

Add to entity descriptions:
```
- Targets: numerical KPI targets linked to data table columns (e.g. "DAU >= 50 by Apr 3")
- Visualizations: charts (line, bar, area, pie, stat) built from data table columns
```

Add to rules section:
```
- When the user mentions KPIs, metrics, thresholds, or numerical targets, use create_target to create targets linked to data table columns. NEVER embed target info in goal descriptions — always use the create_target tool.
- When creating targets, first call list_data_tables to find the relevant table and understand its column names and types.
- When the user has data tables with numeric data and asks for charts or visualizations, use create_visualization. Choose: line for time series, bar for comparisons, pie for proportions, stat for single metrics.
- Goals support hierarchy (sub-goals). Use parentGoalId to create sub-goals under existing goals.
```

---

## Part C: Approval Button Reliability

### C1. Root Cause

The LLM sometimes produces a planning/explanation response without `<tool_call>` XML blocks. The tool loop at `handler.ts:248` exits immediately (`if (!parsed.hasToolCalls) break`), so no `pendingActions` are created, and the ActionGroup never renders.

This happened in the user's session: the AI described creating goals/data tables/jobs but didn't emit tool calls, so no approval buttons appeared.

### C2. Fix 1 — Stronger Prompt (Primary Fix)

**Modify `agent/src/chat/system-prompt.ts`** — add to rules:

```
- NEVER describe what you "would" or "will" create — if the user asks you to create, update, or delete anything, you MUST include the actual <tool_call> XML blocks in your response. The UI only shows approve/reject buttons when tool_call blocks are present. Text descriptions of actions are not actionable.
```

### C3. Fix 2 — Fallback Nudge (Safety Net)

**Modify `agent/src/chat/handler.ts`** — after the tool loop completes, if:
1. `pendingActions.length === 0`
2. `allToolCalls.length === 0`
3. The response text contains creation-intent language (regex: `/\b(creat|set up|add|configur|defin)\w*\b.{0,40}\b(goal|job|target|visualization|data table)\b/i`)

Then perform ONE retry with a nudge prompt asking the LLM to produce actual `<tool_call>` blocks for the actions it described. This catches the case where the LLM "forgets" to use tools on the first pass.

Max 1 retry to avoid latency doubling. Log when the nudge fires for observability.

### C4. Fix 3 — Diagnostic Logging

**Modify `agent/src/chat/handler.ts`** — at end of tool loop, log when a response >50 chars has zero tool calls. This helps track frequency of the issue without code complexity:

```typescript
console.error(`[chat] response with no tool calls (${text.length} chars). First 200: ${text.slice(0, 200)}`);
```

---

## Build Sequence

### Phase 1: Data Layer (no frontend changes, backward compatible)
1. Shared types in `shared/src/index.ts` — add `parentId` to Goal types, add `GoalTreeNode`, `GoalDeleteSnapshot`
2. Migration `0031_add_goal_hierarchy.sql`
3. Register in `migrations-data.ts`
4. Update `schema.ts` — add `parentId` column
5. Update `agent/src/db/queries/goals.ts` — parentId in CRUD
6. New `agent/src/db/queries/goal-hierarchy.ts` — hierarchy helpers + snapshot/restore

### Phase 2: Chat Tools for Targets & Visualizations
7. New `agent/src/chat/target-chat-tools.ts`
8. New `agent/src/chat/visualization-chat-tools.ts`
9. Modify `agent/src/chat/tools.ts` — import and spread new tools
10. Modify `agent/src/chat/tool-executor.ts` — wire delegation
11. Modify `agent/src/chat/action-handler.ts` — FK-linking for targets/visualizations
12. Modify `agent/src/chat/system-prompt.ts` — entity descriptions, rules, sub-goal mention

### Phase 3: Approval Reliability
13. Modify `agent/src/chat/system-prompt.ts` — stronger tool-call enforcement
14. Modify `agent/src/chat/handler.ts` — fallback nudge + diagnostic logging

### Phase 4: IPC + API
15. Modify `agent/src/ipc/handlers/goals.ts` — add children, ancestors, restoreDeleted handlers
16. Modify `src/lib/api.ts` — add getGoalChildren, getGoalAncestors, restoreDeletedGoal

### Phase 5: Sidebar Hierarchy UX
17. New `src/lib/goal-tree.ts` — tree building utilities
18. New `src/hooks/use-goal-drag-nest.ts` — drag-to-nest hook
19. New `src/components/layout/sidebar-goal-add-menu.tsx` — Plus dropdown
20. New `src/components/layout/sidebar-goal-context-menu.tsx` — right-click menu
21. Modify `src/components/layout/sidebar-goal-node.tsx` — recursive rendering, indent, menus
22. Modify `src/components/layout/sidebar-tree.tsx` — tree building, drag-to-nest integration
23. Modify `src/stores/goal-store.ts` — updateGoalParent, delete with undo toast

### Phase 6: Goal Detail + Dashboard
24. New `src/components/goals/goal-breadcrumb.tsx`
25. New `src/components/goals/goal-sub-goals-section.tsx`
26. Modify `src/components/content/goal-detail-view.tsx` — breadcrumb + sub-goals section
27. Modify `src/components/goals/goal-creation-sheet.tsx` — parentGoalId prop
28. Modify `src/components/content/dashboard-insights-section.tsx` — hierarchical target grouping

### Phase 7: Autopilot Integration
29. Modify `agent/src/planner/system-jobs.ts` — include parent goal context in system job generation

### Phase 8: Verification
30. Agent tests: hierarchy queries, circular ref prevention, snapshot/restore
31. Chat tool tests: target/visualization CRUD via chat, column resolution
32. E2E: create hierarchy in sidebar (drag + menu), verify dashboard reflects it
33. E2E: ask chat AI to create targets and visualizations, verify approval buttons appear
34. `npm test` passes

---

## New Files Summary (12)

| File | Lines | Purpose |
|------|-------|---------|
| `agent/src/db/migrations/0031_add_goal_hierarchy.sql` | ~5 | DB migration |
| `agent/src/db/queries/goal-hierarchy.ts` | ~80 | Hierarchy helpers, snapshot/restore |
| `agent/src/chat/target-chat-tools.ts` | ~180 | Target CRUD tools for chat sidebar |
| `agent/src/chat/visualization-chat-tools.ts` | ~200 | Visualization CRUD tools for chat sidebar |
| `src/lib/goal-tree.ts` | ~60 | Tree building utilities |
| `src/hooks/use-goal-drag-nest.ts` | ~80 | Drag-to-nest custom hook |
| `src/components/layout/sidebar-goal-add-menu.tsx` | ~50 | Plus icon dropdown (Sub-Goal / Job) |
| `src/components/layout/sidebar-goal-context-menu.tsx` | ~60 | Right-click context menu |
| `src/components/goals/goal-breadcrumb.tsx` | ~40 | Parent chain breadcrumb |
| `src/components/goals/goal-sub-goals-section.tsx` | ~80 | Sub-goals table in detail view |

## Modified Files Summary (17)

| File | Changes |
|------|---------|
| `shared/src/index.ts` | Add parentId to Goal types, GoalTreeNode, GoalDeleteSnapshot |
| `agent/src/db/schema.ts` | Add parentId column |
| `agent/src/db/migrations-data.ts` | Register migration 0031 |
| `agent/src/db/queries/goals.ts` | parentId in CRUD, circular ref check |
| `agent/src/ipc/handlers/goals.ts` | children, ancestors, restoreDeleted handlers |
| `agent/src/chat/tools.ts` | Import + spread target/viz tools, extend describeAction |
| `agent/src/chat/tool-executor.ts` | Wire target/viz read/write delegation |
| `agent/src/chat/action-handler.ts` | FK-linking for targets/visualizations with "pending" |
| `agent/src/chat/system-prompt.ts` | Entity descriptions, rules, tool-call enforcement |
| `agent/src/chat/handler.ts` | Fallback nudge + diagnostic logging |
| `agent/src/planner/system-jobs.ts` | Parent goal context in system job generation |
| `src/lib/api.ts` | getGoalChildren, getGoalAncestors, restoreDeletedGoal |
| `src/stores/goal-store.ts` | updateGoalParent, delete with undo toast |
| `src/components/layout/sidebar-goal-node.tsx` | Recursive rendering, indent, menus |
| `src/components/layout/sidebar-tree.tsx` | Tree building, drag-to-nest |
| `src/components/content/goal-detail-view.tsx` | Breadcrumb + sub-goals section |
| `src/components/goals/goal-creation-sheet.tsx` | parentGoalId prop |
| `src/components/content/dashboard-insights-section.tsx` | Hierarchical target grouping |

---

## Verification

1. **Hierarchy CRUD**: Create parent goal, create sub-goal via sidebar menu, verify tree renders correctly
2. **Drag-to-nest**: Drag goal right onto another goal, verify nesting. Drag left, verify unnesting
3. **Context menu**: Right-click goal, "Move to...", select new parent, verify hierarchy updates
4. **Cascade delete**: Delete parent with children, verify undo toast appears, click undo, verify restore
5. **Chat targets**: Ask AI "create a target for DAU >= 50 by Apr 3 using the PostHog table", verify approval buttons appear and target is created
6. **Chat visualizations**: Ask AI "create a line chart for DAU over time", verify approval buttons and chart creation
7. **Dashboard hierarchy**: Verify insights section shows targets grouped by goal hierarchy with proper indentation
8. **Goal detail**: Navigate to sub-goal, verify breadcrumb shows parent chain, verify sub-goals section lists children
9. **Approval reliability**: Test 5+ goal/job creation requests in chat, verify approval buttons appear every time
10. **Browser MCP**: Navigate to `http://localhost:1420`, test all sidebar interactions visually
