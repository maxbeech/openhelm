/**
 * In-memory priority queue for pending runs.
 *
 * Priority levels:
 *   0 = manual (highest — user clicked "Run now")
 *   1 = scheduled (normal scheduler tick)
 *   2 = corrective (v2 — automatic retry)
 *
 * Within the same priority, items are processed FIFO (by enqueuedAt).
 * The queue is in-memory but backed by the database for crash recovery:
 * on startup, queued runs are re-enqueued from the DB.
 */

export interface QueueItem {
  runId: string;
  jobId: string;
  priority: number;
  enqueuedAt: number; // Date.now() timestamp
}

/** Compare two items: lower priority first, then earlier enqueuedAt */
function compare(a: QueueItem, b: QueueItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.enqueuedAt - b.enqueuedAt;
}

export class JobQueue {
  private items: QueueItem[] = [];
  private runIdSet = new Set<string>();

  /** Add an item using binary search insertion (O(log n)) */
  enqueue(item: QueueItem): void {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare(this.items[mid], item) <= 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.items.splice(lo, 0, item);
    this.runIdSet.add(item.runId);
  }

  /** Remove and return the highest-priority item, or null if empty */
  dequeue(): QueueItem | null {
    const item = this.items.shift() ?? null;
    if (item) this.runIdSet.delete(item.runId);
    return item;
  }

  /** Remove a specific run from the queue. Returns true if found. */
  remove(runId: string): boolean {
    if (!this.runIdSet.has(runId)) return false;
    const idx = this.items.findIndex((i) => i.runId === runId);
    if (idx >= 0) {
      this.items.splice(idx, 1);
      this.runIdSet.delete(runId);
      return true;
    }
    return false;
  }

  /** Check if a run is already in the queue — O(1) */
  has(runId: string): boolean {
    return this.runIdSet.has(runId);
  }

  /** Number of items in the queue */
  size(): number {
    return this.items.length;
  }

  /** Peek at the next item without removing it */
  peek(): QueueItem | null {
    return this.items[0] ?? null;
  }

  /** Get a snapshot of all items (for status reporting) */
  getAll(): QueueItem[] {
    return [...this.items];
  }

  /** Clear all items from the queue */
  clear(): void {
    this.items = [];
    this.runIdSet.clear();
  }
}

/** Singleton queue instance used by the scheduler and executor */
export const jobQueue = new JobQueue();
