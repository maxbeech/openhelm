import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue, type QueueItem } from "../src/scheduler/queue.js";

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  it("starts empty", () => {
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeNull();
    expect(queue.peek()).toBeNull();
  });

  it("enqueues and dequeues items in FIFO order", () => {
    queue.enqueue({ runId: "a", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "b", jobId: "j2", priority: 1, enqueuedAt: 200 });
    queue.enqueue({ runId: "c", jobId: "j3", priority: 1, enqueuedAt: 300 });

    expect(queue.size()).toBe(3);
    expect(queue.dequeue()!.runId).toBe("a");
    expect(queue.dequeue()!.runId).toBe("b");
    expect(queue.dequeue()!.runId).toBe("c");
    expect(queue.size()).toBe(0);
  });

  it("dequeues by priority (lower number = higher priority)", () => {
    queue.enqueue({ runId: "sched", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "manual", jobId: "j2", priority: 0, enqueuedAt: 200 });
    queue.enqueue({ runId: "correct", jobId: "j3", priority: 2, enqueuedAt: 50 });

    expect(queue.dequeue()!.runId).toBe("manual");
    expect(queue.dequeue()!.runId).toBe("sched");
    expect(queue.dequeue()!.runId).toBe("correct");
  });

  it("uses FIFO within the same priority level", () => {
    queue.enqueue({ runId: "first", jobId: "j1", priority: 0, enqueuedAt: 100 });
    queue.enqueue({ runId: "second", jobId: "j2", priority: 0, enqueuedAt: 200 });
    queue.enqueue({ runId: "third", jobId: "j3", priority: 0, enqueuedAt: 300 });

    expect(queue.dequeue()!.runId).toBe("first");
    expect(queue.dequeue()!.runId).toBe("second");
    expect(queue.dequeue()!.runId).toBe("third");
  });

  it("removes a specific item by runId", () => {
    queue.enqueue({ runId: "a", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "b", jobId: "j2", priority: 1, enqueuedAt: 200 });
    queue.enqueue({ runId: "c", jobId: "j3", priority: 1, enqueuedAt: 300 });

    expect(queue.remove("b")).toBe(true);
    expect(queue.size()).toBe(2);
    expect(queue.dequeue()!.runId).toBe("a");
    expect(queue.dequeue()!.runId).toBe("c");
  });

  it("returns false when removing a non-existent item", () => {
    expect(queue.remove("nonexistent")).toBe(false);
  });

  it("peeks without removing", () => {
    queue.enqueue({ runId: "a", jobId: "j1", priority: 1, enqueuedAt: 100 });

    expect(queue.peek()!.runId).toBe("a");
    expect(queue.size()).toBe(1);
    expect(queue.peek()!.runId).toBe("a"); // Still there
  });

  it("getAll returns a snapshot", () => {
    queue.enqueue({ runId: "a", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "b", jobId: "j2", priority: 0, enqueuedAt: 200 });

    const all = queue.getAll();
    expect(all.length).toBe(2);
    expect(all[0].runId).toBe("b"); // Higher priority first
    expect(all[1].runId).toBe("a");

    // Mutating snapshot doesn't affect queue
    all.pop();
    expect(queue.size()).toBe(2);
  });

  it("clears all items", () => {
    queue.enqueue({ runId: "a", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "b", jobId: "j2", priority: 1, enqueuedAt: 200 });

    queue.clear();
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeNull();
  });

  it("manual trigger takes priority over scheduled runs", () => {
    // Simulate: 3 scheduled runs already in queue
    queue.enqueue({ runId: "s1", jobId: "j1", priority: 1, enqueuedAt: 100 });
    queue.enqueue({ runId: "s2", jobId: "j2", priority: 1, enqueuedAt: 200 });
    queue.enqueue({ runId: "s3", jobId: "j3", priority: 1, enqueuedAt: 300 });

    // User clicks "Run now"
    queue.enqueue({ runId: "manual", jobId: "j4", priority: 0, enqueuedAt: 400 });

    // Manual run should come first despite being added last
    expect(queue.dequeue()!.runId).toBe("manual");
  });
});
