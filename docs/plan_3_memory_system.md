# Memory System — Implementation Plan

## Context

OpenHelm currently has no cross-run memory. Each Claude Code job runs in isolation — it doesn't know what happened in previous runs, what the user prefers, or what workflows have been established. The chat sidebar also has no project knowledge beyond what it reads from the DB entities.

This plan adds a full memory system that automatically learns from runs, goals, and jobs, injects relevant context before every LLM operation, and gives users a UI to manually manage memories. The design prioritises lightweight atomic memories, efficient SQLite-only retrieval, and data-source pointers over data copying.

---

## 1. Data Model

### 1.1 `memories` Table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `crypto.randomUUID()` |
| `project_id` | TEXT FK→projects | CASCADE delete |
| `goal_id` | TEXT FK→goals | SET NULL on delete |
| `job_id` | TEXT FK→jobs | SET NULL on delete |
| `type` | TEXT | `semantic \| episodic \| procedural \| source` |
| `content` | TEXT | Atomic, single-idea (1-2 sentences max) |
| `source_type` | TEXT | `run \| goal \| job \| chat \| user \| system` |
| `source_id` | TEXT nullable | The ID of the originating entity |
| `importance` | REAL | 0.0-1.0 float |
| `access_count` | INTEGER | Incremented on retrieval |
| `last_accessed_at` | TEXT nullable | ISO 8601 |
| `tags` | TEXT | JSON array of strings |
| `embedding` | TEXT | JSON array of 384 floats (all-MiniLM-L6-v2) |
| `is_archived` | INTEGER | Boolean (0/1) |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

Indexes on: `project_id`, `goal_id`, `job_id`, `type`, `is_archived`.

**Tags as JSON array** (not a join table) — matches existing patterns (`scheduleConfig`, `toolCalls`) and avoids complexity for this cardinality.

### 1.1b `run_memories` Table (Transparency Tracking)

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT FK→runs | CASCADE delete |
| `memory_id` | TEXT FK→memories | CASCADE delete |

Composite PK on `(run_id, memory_id)`. Records which memories were injected into each run's prompt, enabling the "Memories Used" section in the run detail panel.

### 1.2 Memory Types

| Type | Purpose | Example |
|---|---|---|
| `semantic` | Stable facts | "Website uses Next.js 14 with App Router" |
| `episodic` | Run experiences | "API endpoint changed from /v1 to /v2, causing 404s" |
| `procedural` | Workflows/processes | "Deploy: build → migrate → deploy via Vercel CLI" |
| `source` | External data pointers | "SEO metrics available via Google Search Console MCP" |

### 1.3 Default Tags

`goal`, `data-source`, `preference`, `workflow`, `error-pattern`, `tool-usage`, `architecture`, `convention`

Custom tags can be created by the AI during extraction (just strings — no separate table).

### 1.4 Shared Types

Add to `shared/src/index.ts`:
- `MemoryType`, `MemorySourceType` unions
- `Memory` interface
- `CreateMemoryParams`, `UpdateMemoryParams`, `ListMemoriesParams`
- `MemoryRetrievalContext` (for retrieval scoring)
- `DEFAULT_MEMORY_TAGS` constant

### Files
- `agent/src/db/schema.ts` — add `memories` table
- `agent/src/db/migrations/0015_add_memories.sql` — migration + indexes
- `agent/src/db/queries/memories.ts` — CRUD functions (new, ~150 lines)
- `shared/src/index.ts` — add types

---

## 2. Retrieval System (Local Embeddings — Zero Cloud Cost)

Uses `@xenova/transformers` to run `all-MiniLM-L6-v2` locally in Node.js (~23MB model, 384-dimensional vectors). Embeddings are generated on memory create/update and stored as JSON arrays in the `embedding` column. No tokens consumed, no cloud calls.

### 2.1 Embedding Pipeline

**Dependency**: `@xenova/transformers` added to `agent/package.json`

New file: `agent/src/memory/embeddings.ts` (~60 lines)

```typescript
import { pipeline } from "@xenova/transformers";

let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are normalized, so dot product = cosine similarity
}
```

Model is loaded lazily on first use (~1-2s), then cached in memory for the session. The model itself is downloaded once to a local cache dir (~23MB).

### 2.2 Scoring Algorithm

```
score = 0.4 × cosine_similarity + 0.15 × scope_match + 0.15 × importance
      + 0.15 × type_weight + 0.15 × recency
```

- **Cosine similarity** (0-0.4): semantic match between query embedding and stored memory embedding. This is the primary signal — true semantic understanding.
- **Scope match** (0-0.15): job-level = 0.15, goal-level = 0.1, project-level = 0.05
- **Importance** (0-0.15): stored value × 0.15
- **Type weight** (0-0.15): varies by context (procedural weighted higher for job runs)
- **Recency** (0-0.15): exponential decay, half-life ~21 days

### 2.3 Score Threshold

**Minimum score: 0.3** — if no memories pass this threshold, nothing is injected. This prevents irrelevant memories from polluting prompts. The threshold is checked after scoring all candidates.

### 2.4 Prompt Injection Format

Memories are appended as a structured section:

```
---

## Relevant Context (from memory)

### Facts
- Website uses Next.js 14 with App Router

### Workflows
- Deploy process: build → migrate → deploy via Vercel CLI

### Previous Run Insights
- Last attempt failed because the API endpoint changed to /v2/

### Data Sources
- SEO metrics available via Google Search Console MCP
```

### Files
- `agent/src/memory/embeddings.ts` — local embedding model + cosine similarity (~60 lines)
- `agent/src/memory/retriever.ts` — scoring algorithm + retrieval (~120 lines)
- `agent/src/memory/prompt-builder.ts` — format memories for injection (~60 lines)

---

## 3. Extraction Pipeline (Automatic Memory Creation)

### 3.1 Core Extractor

Calls haiku (classification tier, 60s timeout) with:
- The content to analyze (run summary + truncated logs, goal description, job prompt)
- Existing memories for the project/goal/job scope (for deduplication)
- JSON schema requiring structured output: `{ memories: [{ type, content, importance, tags, action }] }`

Each extracted memory must be atomic (single idea). The LLM chooses `action: "create" | "update" | "merge"`.

**System prompt instructs**:
- Prefer data-source pointers over copying data
- Keep memories concise (1-2 sentences)
- Use default tags when applicable, create custom tags sparingly
- Importance: 0.9-1.0 critical facts, 0.5-0.8 useful context, 0.1-0.4 observations
- For "update": replace stale content with fresh version
- For "merge": combine with an existing memory (target identified by mergeTargetId)

### 3.2 Trigger Points

All use the existing fire-and-forget pattern (`.then().catch()`, no await):

| Trigger | Location | Content analyzed |
|---|---|---|
| **After job run completion** | `executor/index.ts:onRunCompleted` | Run summary + truncated logs |
| **After goal creation** | `ipc/handlers/goals.ts` | Goal name + description |
| **After job creation** | `ipc/handlers/jobs.ts` | Job name + prompt |
| **Manual** | `ipc/handlers/memories.ts` | Direct user input |
| **Via chat** | `chat/tool-executor.ts` | Chat tool `save_memory` |

### 3.3 Post-Run Extraction Detail

In `onRunCompleted()`, after the existing correction note evaluation block (line ~420 of `executor/index.ts`), add:

```typescript
// Memory extraction: learn from completed runs (success or failure)
extractMemoriesFromRun(runId, job).catch((err) =>
  console.error(`[executor] memory extraction error:`, err)
);
```

The `extractMemoriesFromRun()` function:
1. Calls `collectRunLogs()` → truncates to last 8K chars (same as summarizer)
2. Gets run summary
3. Loads existing memories for the project+job scope
4. Calls `extractMemories()` with content = summary + logs
5. Persists results via memory queries, emits `memory.created`/`memory.updated` events

### Files
- `agent/src/memory/extractor.ts` — core LLM extraction (~120 lines)
- `agent/src/memory/run-extractor.ts` — post-run trigger (~80 lines)
- `agent/src/memory/goal-extractor.ts` — post-goal trigger (~50 lines)
- `agent/src/memory/job-extractor.ts` — post-job trigger (~50 lines)
- `agent/src/planner/schemas.ts` — add `MEMORY_EXTRACTION_SCHEMA`

---

## 4. Injection Points (Memory → Prompt)

### 4.1 Before Job Runs

In `executor/index.ts`, after building `effectivePrompt` (line ~183) and before `this.runnerFn()`:

```typescript
const memories = retrieveRelevantMemories({
  projectId: job.projectId,
  goalId: job.goalId ?? undefined,
  jobId: job.id,
  promptKeywords: extractKeywords(effectivePrompt),
  maxResults: 10,
});
if (memories.length > 0) {
  effectivePrompt = buildPromptWithMemories(effectivePrompt, memories);
  // Record which memories were injected (for run detail transparency)
  saveRunMemories(runId, memories.map(m => m.id));
}
```

The `run_memories` records are then queried in the run detail panel to show a "Memories Used" collapsible section, listing each injected memory's content and type.

### 4.2 Before Chat Responses

In `chat/system-prompt.ts`, add a `buildMemorySection()` that retrieves up to 8 relevant memories and injects them into the system prompt between the Current View section and the Tools section.

### 4.3 Before Planning Operations

In planner modules (`generate.ts`, `assess-and-generate.ts`), inject semantic + procedural memories into the planning system prompt to give the planner project knowledge.

---

## 5. Lifecycle Management (Pruning & Decay)

### 5.1 Decay Algorithm

```
For memories > 7 days old:
  accessBoost = min(accessCount × 0.02, 0.2)
  decayRate = 0.01 per day
  newImportance = max(0.1, importance - decayRate × (ageDays - 7) + accessBoost)
```

Frequently accessed memories resist decay. Unused memories fade.

### 5.2 Auto-Archive

If `importance <= 0.1` AND no access in 60 days → auto-archive.

### 5.3 Per-Project Cap (Auto-Managed Silently)

Max 200 active (non-archived) memories per project. When the cap is hit during extraction:

1. **Score all existing memories** using the retrieval scoring (importance + recency + access count)
2. **Auto-archive** the lowest-scoring memories to make room for new ones
3. **Merge detection**: during extraction, the LLM is given existing memories and can flag `action: "merge"` to combine similar ones, freeing up slots
4. No user intervention needed — results visible in Memory tab
5. Archived memories remain accessible via "Show Archived" toggle but are excluded from retrieval

### 5.4 When Decay Runs

- Fire-and-forget after every 10th run completion per project (modulo check on run count)
- Manual trigger via UI "Prune" button or IPC `memories.prune`

### Files
- `agent/src/memory/pruner.ts` — decay + cleanup (~120 lines)

---

## 6. IPC Methods & Events

### Methods

| Method | Params | Returns |
|---|---|---|
| `memories.list` | `ListMemoriesParams` | `Memory[]` |
| `memories.get` | `{ id }` | `Memory` |
| `memories.create` | `CreateMemoryParams` | `Memory` |
| `memories.update` | `UpdateMemoryParams` | `Memory` |
| `memories.delete` | `{ id }` | `{ deleted: boolean }` |
| `memories.archive` | `{ id }` | `Memory` |
| `memories.search` | `{ projectId, query }` | `Memory[]` |
| `memories.listTags` | `{ projectId }` | `string[]` |
| `memories.prune` | `{ projectId }` | `{ pruned: number }` |
| `memories.count` | `{ projectId? }` | `{ count: number }` |
| `memories.listForRun` | `{ runId }` | `Memory[]` |

### Events

| Event | Data |
|---|---|
| `memory.created` | `Memory` |
| `memory.updated` | `Memory` |
| `memory.deleted` | `{ id }` |
| `memory.extracted` | `{ projectId, count, source }` |

### Files
- `agent/src/ipc/handlers/memories.ts` — IPC handlers (new, ~120 lines)
- `agent/src/ipc/handlers/index.ts` — register `registerMemoryHandlers()`

---

## 7. Chat Integration

### 7.1 New Chat Tools

| Tool | Type | Description |
|---|---|---|
| `list_memories` | Read | List/filter project memories |
| `save_memory` | Write | Save a new memory (user approval) |
| `update_memory` | Write | Update existing memory |
| `forget_memory` | Write | Delete a memory |

### 7.2 System Prompt Memory Section

Add `buildMemorySection()` to `system-prompt.ts`:
- Retrieves up to 8 relevant memories for the active project + current view context
- Rendered between Current View and Tools sections
- Tells the LLM to use `save_memory` when user shares important information

### Files to modify
- `agent/src/chat/tools.ts` — add 4 tool definitions
- `agent/src/chat/tool-executor.ts` — add tool execution handlers
- `agent/src/chat/system-prompt.ts` — add memory section builder

---

## 8. Frontend

### 8.1 Sidebar Update

Add a "Memory" button between Dashboard and the Project dropdown in `sidebar.tsx`, using the `Brain` icon from lucide-react. Shows memory count badge.

### 8.2 Content View

Add `"memory"` to `ContentView` union in `app-store.ts`.

### 8.3 Store

New `src/stores/memory-store.ts` (~100 lines):
- State: `memories`, `allTags`, `loading`, `error`, `filterType`, `filterTag`, `searchQuery`
- Actions: `fetchMemories`, `createMemory`, `updateMemory`, `deleteMemory`, `archiveMemory`, `pruneMemories`
- Event handlers: `addMemoryToStore`, `updateMemoryInStore`, `removeMemoryFromStore`

### 8.4 Components

```
src/components/memory/
  memory-view.tsx            — Main content view with list + filters + create button (~180 lines)
  memory-card.tsx            — Individual memory card with edit/archive actions (~100 lines)
  memory-create-dialog.tsx   — Manual creation dialog (~120 lines)
  memory-edit-dialog.tsx     — Edit dialog (~120 lines)
  memory-type-badge.tsx      — Colored badge for memory type (~40 lines)
  memory-filters.tsx         — Filter bar: type dropdown, tag dropdown, search input (~80 lines)
```

### 8.5 Run Detail: "Memories Used" Section

Update `src/components/runs/run-detail-panel.tsx` to add a collapsible "Memories Used" section. Fetches via `memories.listForRun` IPC method. Shows each injected memory's type badge + content. Only rendered when the run has associated memories.

### 8.5 Memory View Layout

```
┌──────────────────────────────────────────────┐
│ Memory                              [+ New]  │
│                                              │
│ 🔍 Search memories...                        │
│ [All Types ▼] [All Tags ▼]       [Prune]    │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ semantic  [architecture] [preference]    │ │
│ │ Website uses Next.js 14 with App Router  │ │
│ │ Importance: 0.8  Used: 12x  2d ago       │ │
│ │ Source: run abc123          [Edit] [Del]  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ procedural  [workflow]                   │ │
│ │ Deploy: build → migrate → deploy via CLI │ │
│ │ Importance: 0.9  Used: 5x   1d ago       │ │
│ │ Source: run def456          [Edit] [Del]  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ── Archived (3) ──────────── [Show/Hide]     │
└──────────────────────────────────────────────┘
```

### 8.6 App.tsx Updates

- Import `useMemoryStore`, add event listeners for `memory.created`, `memory.updated`, `memory.deleted`
- Add `{contentView === "memory" && <MemoryView />}` to content rendering
- Add `fetchMemories` to initial data load

### Files
- `src/stores/app-store.ts` — add "memory" to ContentView
- `src/stores/memory-store.ts` — new store
- `src/lib/api.ts` — add memory API functions
- `src/components/layout/sidebar.tsx` — add Memory button
- `src/components/memory/*.tsx` — 6 new component files
- `src/App.tsx` — event handlers + view routing

---

## 9. Implementation Phases

### Phase 1: Database + Shared Types
1. `agent/src/db/schema.ts` — add memories table
2. `agent/src/db/migrations/0015_add_memories.sql`
3. `agent/src/db/migrations/meta/_journal.json`
4. `agent/src/db/queries/memories.ts`
5. `shared/src/index.ts` — Memory types
6. Tests: `agent/test/memory-queries.test.ts`

### Phase 2: Retrieval System
7. `agent/src/memory/retriever.ts`
8. `agent/src/memory/prompt-builder.ts`
9. Tests: `agent/test/memory-retriever.test.ts`

### Phase 3: IPC Handlers
10. `agent/src/ipc/handlers/memories.ts`
11. `agent/src/ipc/handlers/index.ts` — register
12. `src/lib/api.ts` — API functions

### Phase 4: Frontend UI
13. `src/stores/app-store.ts` — add "memory"
14. `src/stores/memory-store.ts`
15. `src/components/layout/sidebar.tsx` — Memory button
16. `src/components/memory/memory-type-badge.tsx`
17. `src/components/memory/memory-filters.tsx`
18. `src/components/memory/memory-card.tsx`
19. `src/components/memory/memory-view.tsx`
20. `src/components/memory/memory-create-dialog.tsx`
21. `src/components/memory/memory-edit-dialog.tsx`
22. `src/App.tsx` — events + routing
23. Tests: `src/stores/memory-store.test.ts`

### Phase 5: LLM Extraction Pipeline
24. `agent/src/planner/schemas.ts` — MEMORY_EXTRACTION_SCHEMA
25. `agent/src/memory/extractor.ts`
26. `agent/src/memory/run-extractor.ts`
27. `agent/src/memory/goal-extractor.ts`
28. `agent/src/memory/job-extractor.ts`
29. `agent/src/executor/index.ts` — add post-run extraction call
30. `agent/src/ipc/handlers/goals.ts` — add post-creation extraction
31. `agent/src/ipc/handlers/jobs.ts` — add post-creation extraction
32. Tests: `agent/test/memory-extractor.test.ts`

### Phase 6: Prompt Injection
33. `agent/src/executor/index.ts` — inject memories before runs
34. `agent/src/chat/system-prompt.ts` — inject memories into chat

### Phase 7: Chat Tools
35. `agent/src/chat/tools.ts` — add memory tools
36. `agent/src/chat/tool-executor.ts` — add execution handlers

### Phase 8: Lifecycle Management
37. `agent/src/memory/pruner.ts`
38. Tests: `agent/test/memory-pruner.test.ts`

---

## 10. Verification Plan

### Automated Tests
- `npm test` (root) — frontend tests pass
- `cd agent && npm test` — agent tests pass
- `npx tsc -b` — typecheck clean across all workspaces

### Manual Testing
1. Create a project, goal, and job → verify memories auto-extracted after goal/job creation
2. Trigger a job run → verify memories extracted from run results
3. Open Memory tab in sidebar → verify memories display with correct types/tags
4. Create, edit, archive, delete memories manually via UI
5. Filter by type and tag in Memory view
6. Search memories via search input
7. Chat: ask "what do you remember about this project?" → verify memory section in response
8. Chat: tell it "remember that we use PostgreSQL" → verify `save_memory` tool proposed
9. Run a job → verify relevant memories appear in the job's effective prompt (check run logs)
10. Run Prune → verify low-importance old memories get archived
11. Verify memory count badge updates in sidebar after extraction events
