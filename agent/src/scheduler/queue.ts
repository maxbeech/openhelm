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

export class JobQueue {
  private items: QueueItem[] = [];

  /** Add an item to the queue, maintaining priority + FIFO order */
  enqueue(item: QueueItem): void {
    this.items.push(item);
    this.items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  /** Remove and return the highest-priority item, or null if empty */
  dequeue(): QueueItem | null {
    return this.items.shift() ?? null;
  }

  /** Remove a specific run from the queue. Returns true if found. */
  remove(runId: string): boolean {
    const idx = this.items.findIndex((i) => i.runId === runId);
    if (idx >= 0) {
      this.items.splice(idx, 1);
      return true;
    }
    return false;
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
  }
}

/** Singleton queue instance used by the scheduler and executor */
export const jobQueue = new JobQueue();
