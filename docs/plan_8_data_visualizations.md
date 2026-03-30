# Plan 8: Data Visualizations

## Context

OpenHelm has data tables (plan 6) and target tracking (plan 7), but users have no way to visualize their data. Targets show text-based progress bars, but there are no time-series charts, bar charts, or other visual representations of data table contents. This limits users' ability to spot trends, track goal progress visually, and understand the health of their projects at a glance.

This plan adds **Data Visualizations** — charts that render data table contents as visual graphs. Visualizations are project-scoped, linked to data tables, and optionally associated with goals or jobs. The autopilot system can auto-suggest or auto-create charts when it detects consistently-written numeric data.

---

## 1. Charting Library

**Decision: Recharts** (`recharts` npm package)

**Why:**
- React-native composable API (`<LineChart>`, `<Bar>`, `<Tooltip>`) — fits the existing JSX component pattern
- Built on D3 for correct axis ticking, date formatting, and curve interpolation
- Responsive containers built-in (`<ResponsiveContainer>`)
- Supports all needed chart types: line, bar, area, pie
- Good TypeScript support
- ~140KB gzipped — acceptable for a Tauri desktop app (loaded from local filesystem)

**What stays unchanged:** The existing custom `TokensChart` (HTML divs) and `ClaudeUsageChart` (custom SVG) are NOT migrated. They work well for their specific use cases. Recharts is used only for the new data table visualizations.

---

## 2. Data Model

### New `visualizations` table (migration `0029_add_visualizations.sql`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID |
| `project_id` | text FK→projects (CASCADE) | Required |
| `goal_id` | text FK→goals (SET NULL) | Optional — associate with a goal |
| `job_id` | text FK→jobs (SET NULL) | Optional — associate with a job |
| `data_table_id` | text FK→data_tables (CASCADE) | Which table provides the data |
| `name` | text NOT NULL | Display name |
| `chart_type` | text NOT NULL DEFAULT 'line' | line/bar/area/pie/stat |
| `config` | text NOT NULL DEFAULT '{}' | JSON: VisualizationConfig |
| `status` | text NOT NULL DEFAULT 'active' | active/suggested/dismissed |
| `source` | text NOT NULL DEFAULT 'user' | user/system |
| `sort_order` | integer NOT NULL DEFAULT 0 | Display ordering |
| `created_at` | text NOT NULL | ISO 8601 |
| `updated_at` | text NOT NULL | ISO 8601 |

Indexes on `project_id`, `goal_id`, `job_id`, `data_table_id`, `status`.

### Shared Types (add to `shared/src/index.ts`)

```typescript
export type ChartType = "line" | "bar" | "area" | "pie" | "stat";
export type VisualizationStatus = "active" | "suggested" | "dismissed";
export type VisualizationSource = "user" | "system";

export interface VisualizationSeriesConfig {
  columnId: string;       // Stable column ID (col_xxxxx)
  label?: string;         // Display label override
  color?: string;         // Color override
  aggregation?: TargetAggregation; // Reuse existing enum
}

export interface VisualizationConfig {
  xColumnId?: string;                 // X-axis column (date or category)
  series: VisualizationSeriesConfig[];// Y-axis columns (1+)
  valueColumnId?: string;             // For pie: value column
  labelColumnId?: string;             // For pie: label column
  statColumnId?: string;              // For stat: single column
  statAggregation?: TargetAggregation;// For stat: how to compute
  rowLimit?: number;                  // Max rows (default: 500)
  sortDirection?: "asc" | "desc";     // X-axis sort
  showLegend?: boolean;
  showGrid?: boolean;
  colors?: string[];                  // Custom color palette
}

export interface Visualization {
  id: string;
  projectId: string;
  goalId: string | null;
  jobId: string | null;
  dataTableId: string;
  name: string;
  chartType: ChartType;
  config: VisualizationConfig;
  status: VisualizationStatus;
  source: VisualizationSource;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// CRUD param interfaces
export interface CreateVisualizationParams { ... }
export interface UpdateVisualizationParams { ... }
export interface ListVisualizationsParams {
  projectId?: string;
  goalId?: string;
  jobId?: string;
  dataTableId?: string;
  status?: VisualizationStatus;
}
```

### Chart Types

| Type | When to Use | Config |
|------|------------|--------|
| **line** | Time-series with date x-axis. Default for date+numeric. | `xColumnId` (date), `series[]` (numeric) |
| **area** | Like line but emphasizes volume. Cumulative metrics. | Same as line |
| **bar** | Category comparison or small-N data. | `series[]` (numeric), optional `xColumnId` |
| **pie** | Part-to-whole (2-7 slices ideal). | `valueColumnId`, `labelColumnId` |
| **stat** | Single headline number (KPI card). | `statColumnId`, `statAggregation` |

---

## 3. Dashboard UX Redesign

### Current Issues
The dashboard is a single scrolling column. Users must scroll past Claude Usage widgets to reach alerts. There's no target or visualization section. With data charts added, the page would become even longer.

### Confirmed: Tabbed Dashboard

```
[Overview Stats: Active Goals | Enabled Jobs | Running Now]
────────────────────────────────────────────────
[  Alerts & Actions  |  System  |  Insights  ]
════════════════════════════════════════════════
              [Tab content here]
```

- **Alerts & Actions tab**: Autopilot proposals, visualization suggestions, dashboard alerts (needs attention), sorted by priority
- **System tab**: Claude usage widgets + chart, recent runs, token usage chart
- **Insights tab**: Target progress (grouped by goal), data table visualizations (grouped by goal/project)

**Pros:** Clean, fast switching, focused views, each tab has a clear purpose, no scrolling past irrelevant content
**Cons:** Alerts hidden when on other tabs — mitigated by badge count on tab label ("Alerts (3)")

The overview stats bar stays visible across all tabs for quick-glance metrics. Alert count badge on the tab prevents missing urgent items. Each tab is optimized for its specific content.

---

## 4. Insights Tab Layout

### When a specific project is selected:

```
Insights Tab
├── Target Progress
│   ├── Goal: "Improve test coverage"
│   │   ├── TargetProgressBar: Test Coverage ≥80% (67.3%, 84%)
│   │   └── TargetProgressBar: Error Count ≤5 (12, 42%)
│   └── Goal: "Scale API"
│       └── TargetProgressBar: P99 Latency ≤200ms (340ms, 59%)
│
├── Separator
│
└── Charts
    ├── [Line chart: Test Coverage Over Time]
    ├── [Bar chart: Error Count by Category]
    └── "Add Chart" button
```

### When "All Projects" is selected:

```
Insights Tab
├── Project: "Backend API"
│   ├── Targets: [progress bars]
│   └── Charts: [chart cards]
├── Project: "Mobile App"
│   ├── Targets: [progress bars]
│   └── Charts: [chart cards]
└── "No targets or charts yet" empty state
```

### In Goal Detail View:

```
Goal Detail
├── Header + status
├── Targets (existing TargetList)
├── Visualizations (NEW — charts for this goal's targets/tables)
├── User Jobs
└── System Jobs
```

### In Job Detail Panel (320px wide):

```
Job Detail Panel
├── ...existing sections...
├── Token Usage Chart (existing)
├── Targets (existing)
├── Charts (NEW — compact chart cards, max 2 visible)
├── Recent Runs
└── Actions
```

---

## 5. Autopilot Visualization Monitoring

### Trigger: Event-driven with Debounce

When `dataTable.rowsChanged` fires (already emitted by the data tables IPC handler), schedule a visualization check with a 30-second debounce. This catches batch writes without reacting to every single row insert.

### Algorithm (Deterministic — No LLM Required)

```
onDataTableRowsChanged(tableId):
  table = getDataTable(tableId)
  if table.rowCount < 5: return  // Not enough data

  numericCols = table.columns.filter(c => c.type === "number")
  if numericCols.length === 0: return  // Nothing to chart

  dateCols = table.columns.filter(c => c.type === "date")

  // Check if all numeric columns already have a visualization
  existingVizs = listVisualizations({ dataTableId: tableId })
  coveredColIds = new Set(
    existingVizs.flatMap(v => [
      ...v.config.series.map(s => s.columnId),
      v.config.valueColumnId, v.config.statColumnId
    ].filter(Boolean))
  )
  uncoveredCols = numericCols.filter(c => !coveredColIds.has(c.id))
  if uncoveredCols.length === 0: return  // Already covered

  // Auto-select chart type
  if dateCols.length > 0 && table.rowCount >= 5:
    chartType = "line", xColumnId = dateCols[0].id
  elif table.rowCount <= 10:
    chartType = "bar", xColumnId = null
  else:
    chartType = "bar", xColumnId = null

  config = {
    xColumnId,
    series: uncoveredCols.map(c => ({ columnId: c.id, label: c.name })),
    showLegend: uncoveredCols.length > 1,
    showGrid: true,
  }

  // Gate by autopilot mode
  mode = getAutopilotMode()
  if mode === "full_auto":
    createVisualization({ ..., status: "active", source: "system" })
    emit("visualization.created", ...)
  elif mode === "approval_required":
    createVisualization({ ..., status: "suggested", source: "system" })
    emit("visualization.suggested", ...)
  // off: do nothing
```

### Where Suggestions Appear

- **Dashboard Alerts & Actions tab**: Suggested visualizations shown as actionable cards with "Accept" / "Dismiss" buttons, alongside autopilot proposals
- **Goal/Job detail view**: If the suggestion is linked to a goal/job, shown inline with a "Suggested by OpenHelm" banner

### Startup Backfill

`backfillMissingVisualizations()` runs once at agent startup, iterating all tables with `rowCount >= 5` and numeric columns, creating suggestions for any without visualizations. Same pattern as `backfillMissingAutopilotJobs()`.

---

## 6. Chart Rendering Architecture

### ChartRenderer Component

Central switch component that receives a `Visualization` + `DataTableRow[]` and delegates to the appropriate chart:

```typescript
function ChartRenderer({ visualization, rows, columns, compact }: Props) {
  const chartData = useMemo(() => prepareChartData(visualization, rows, columns), [visualization, rows, columns]);

  switch (visualization.chartType) {
    case "line":   return <LineChartViz data={chartData} config={visualization.config} compact={compact} />;
    case "bar":    return <BarChartViz ... />;
    case "area":   return <AreaChartViz ... />;
    case "pie":    return <PieChartViz ... />;
    case "stat":   return <StatCardViz ... />;
  }
}
```

### Data Preparation Pipeline

1. Fetch rows from data table (respecting `rowLimit` from config)
2. For each series column, extract numeric values from rows (reuse `extractColumnValues` pattern from target-evaluator.ts)
3. For x-axis: parse dates or use category labels
4. Sort by x-axis value (ascending by default)
5. Format into Recharts-compatible data array: `[{ x: "2025-01-01", series1: 67.3, series2: 12 }, ...]`

### Theming

Charts use Tailwind CSS variables for colors:
- Primary series: `hsl(var(--primary))`
- Secondary series: `hsl(var(--chart-2))` through `hsl(var(--chart-5))`
- Grid/axis: `hsl(var(--muted))`
- Tooltips: match shadcn/ui popover styling

---

## 7. IPC Endpoints

Register in `agent/src/ipc/handlers/visualizations.ts`:

| Method | Params | Returns |
|--------|--------|---------|
| `visualizations.list` | `ListVisualizationsParams` | `Visualization[]` |
| `visualizations.get` | `{ id }` | `Visualization` |
| `visualizations.create` | `CreateVisualizationParams` | `Visualization` |
| `visualizations.update` | `UpdateVisualizationParams` | `Visualization` |
| `visualizations.delete` | `{ id }` | `{ deleted: boolean }` |
| `visualizations.accept` | `{ id }` | `Visualization` (status→active) |
| `visualizations.dismiss` | `{ id }` | `Visualization` (status→dismissed) |
| `visualizations.count` | `{ projectId }` | `{ count: number }` |

---

## 8. MCP Tools for AI

Add to `agent/src/mcp-servers/data-tables/visualization-tools.ts`:

| Tool | Purpose |
|------|---------|
| `list_visualizations` | List visualizations for a project/goal/job |
| `create_visualization` | Create a new chart |
| `update_visualization` | Modify chart config |
| `delete_visualization` | Remove a chart |

Registered alongside existing data table MCP tools. AI can create visualizations during job runs.

---

## 9. New and Modified Files

### New Files (16)

| File | Purpose | Est. Lines |
|------|---------|------------|
| `agent/src/db/migrations/0029_add_visualizations.sql` | DB migration | 15 |
| `agent/src/db/queries/visualizations.ts` | CRUD queries | 120 |
| `agent/src/ipc/handlers/visualizations.ts` | IPC handlers | 100 |
| `agent/src/data-tables/visualization-suggester.ts` | Autopilot monitoring logic | 150 |
| `agent/src/mcp-servers/data-tables/visualization-tools.ts` | MCP tool definitions | 150 |
| `src/stores/visualization-store.ts` | Zustand store | 90 |
| `src/components/visualizations/chart-renderer.tsx` | Core switch component | 180 |
| `src/components/visualizations/line-chart.tsx` | Recharts line chart | 120 |
| `src/components/visualizations/bar-chart.tsx` | Recharts bar chart | 100 |
| `src/components/visualizations/area-chart.tsx` | Recharts area chart | 100 |
| `src/components/visualizations/pie-chart.tsx` | Recharts pie chart | 90 |
| `src/components/visualizations/stat-card.tsx` | Single-stat KPI card | 60 |
| `src/components/visualizations/visualization-list.tsx` | Chart list for goal/job/project | 120 |
| `src/components/visualizations/chart-create-dialog.tsx` | Create chart form | 220 |
| `src/components/content/dashboard-insights-section.tsx` | Insights tab content | 150 |
| `src/components/content/dashboard-tabs.tsx` | Tab navigation for dashboard | 60 |

### Modified Files (13)

| File | Changes |
|------|---------|
| `shared/src/index.ts` | Add Visualization types (~60 lines) |
| `agent/src/db/schema.ts` | Add visualizations table definition (~20 lines) |
| `agent/src/db/migrations-data.ts` | Register migration 0029 |
| `agent/src/ipc/handlers/index.ts` | Register visualization handlers |
| `agent/src/ipc/handlers/data-tables.ts` | Hook visualization suggestion on rowsChanged |
| `agent/src/mcp-servers/data-tables/tools.ts` | Import + wire visualization tools |
| `agent/src/autopilot/index.ts` | Add backfillMissingVisualizations() call |
| `src/lib/api.ts` | Add visualization API functions (~30 lines) |
| `src/components/content/dashboard-view.tsx` | Major refactor: tabbed layout with 3 tabs |
| `src/components/content/goal-detail-view.tsx` | Add VisualizationList section (~15 lines) |
| `src/components/jobs/job-detail-panel.tsx` | Add compact VisualizationList (~15 lines) |
| `src/App.tsx` | Add visualization event handlers |
| `package.json` | Add `recharts` dependency |

---

## 10. Build Sequence

### Phase 1: Foundation (Data Layer)
1. Shared types in `shared/src/index.ts`
2. Migration `0029_add_visualizations.sql`
3. Register in `migrations-data.ts`
4. Schema in `agent/src/db/schema.ts`
5. Queries in `agent/src/db/queries/visualizations.ts`
6. IPC handlers in `agent/src/ipc/handlers/visualizations.ts`
7. Register in `agent/src/ipc/handlers/index.ts`
8. API functions in `src/lib/api.ts`
9. Store in `src/stores/visualization-store.ts`

### Phase 2: Chart Rendering (Frontend)
10. Install `recharts` dependency
11. Create `chart-renderer.tsx` (central switch)
12. Create `line-chart.tsx`, `bar-chart.tsx`, `area-chart.tsx`, `pie-chart.tsx`, `stat-card.tsx`
13. Create `visualization-list.tsx` (renders charts for a given scope)
14. Create `chart-create-dialog.tsx` (user creation form)

### Phase 3: Dashboard Redesign
15. Create `dashboard-tabs.tsx` (tab navigation component)
16. Create `dashboard-insights-section.tsx` (targets + charts)
17. Refactor `dashboard-view.tsx` to tabbed layout
18. Move existing sections into appropriate tabs

### Phase 4: View Integration
19. Add VisualizationList to `goal-detail-view.tsx`
20. Add compact VisualizationList to `job-detail-panel.tsx`
21. Wire IPC events in `App.tsx` (`visualization.created`, `visualization.suggested`, etc.)

### Phase 5: Autopilot Integration
22. Create `visualization-suggester.ts` (monitoring algorithm)
23. Hook into `dataTable.rowsChanged` in data-tables IPC handler
24. Add `backfillMissingVisualizations()` to agent startup
25. Add suggested chart cards to Dashboard alerts tab

### Phase 6: MCP Tools
26. Create `visualization-tools.ts` (MCP tool definitions)
27. Register in `tools.ts`

### Phase 7: Tests + Verification
28. Unit tests for queries (CRUD)
29. Unit tests for visualization-suggester (algorithm logic)
30. Existing test suite passes (`npm test`)
31. E2E: create data table → add rows → verify auto-suggestion → accept → chart renders
32. E2E: create chart manually in goal detail → verify it appears in dashboard insights tab

---

## 11. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty data table (0 rows) | Chart shows empty state message. Autopilot skips tables with <5 rows. |
| Column deleted after chart created | Chart renderer detects missing column, shows warning banner. |
| Data table deleted | CASCADE deletes all visualizations for that table. |
| Non-numeric values in numeric column | Silently skipped (same as target evaluator). |
| Single row | Line/area degrade to single point; autopilot suggests `stat` instead. |
| Large table (10k+ rows) | Config `rowLimit` caps at 500 by default. Footer note shows count. |
| Column renamed | Config uses stable column IDs, not names. Rename is transparent. |
| Suggested viz dismissed | Status→dismissed. Autopilot includes dismissed in coverage check (won't re-suggest). |
| Autopilot mode OFF→ON | Startup backfill catches uncovered tables. |
| Narrow panel (job detail, 320px) | Charts use `compact` prop: reduced padding, smaller fonts, simplified legends. |

---

## 12. Verification Plan

### Automated Tests
- [ ] `visualizations.test.ts`: CRUD queries, status transitions, cascade delete
- [ ] `visualization-suggester.test.ts`: Algorithm logic — when to suggest, chart type selection, column coverage
- [ ] Existing test suite passes (`npm test` in agent/)

### Manual E2E
- [ ] Create a data table with date + number columns → add 10+ rows → verify auto-suggestion appears (in approval_required mode)
- [ ] Accept suggestion → chart renders on dashboard Insights tab
- [ ] Create visualization manually via goal detail view → select table, columns, chart type → verify chart renders
- [ ] Navigate dashboard tabs → verify Alerts, System, and Insights content is correct
- [ ] Test "All Projects" view → verify charts grouped by project
- [ ] Verify compact chart rendering in job detail panel (320px width)
- [ ] Run AI job that creates a data table + visualization via MCP → verify real-time update in UI
- [ ] Change autopilot mode to OFF → verify no new suggestions generated
- [ ] Dismiss a suggestion → verify it's not re-suggested
- [ ] Delete a data table → verify associated visualizations are removed
