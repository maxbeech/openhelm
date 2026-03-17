/**
 * Memory lifecycle management — decay, auto-archive, and cap enforcement.
 *
 * Decay: importance -= 0.1/day (on 0-10 scale) after 7 days, offset by access frequency.
 * Auto-archive: importance ≤ 1 AND no access in 60 days.
 * Cap: 200 active memories per project — auto-archive lowest-scoring when exceeded.
 */

import {
  listMemories,
  updateMemory,
  archiveMemories,
  countActiveMemories,
} from "../db/queries/memories.js";
import type { Memory } from "@openorchestra/shared";

const MAX_ACTIVE_MEMORIES = 200;
const DECAY_GRACE_DAYS = 7;
const DECAY_RATE_PER_DAY = 0.1; // on 0-10 scale
const ACCESS_BOOST_PER_COUNT = 0.2;
const MAX_ACCESS_BOOST = 2.0;
const AUTO_ARCHIVE_THRESHOLD = 1; // importance ≤ 1
const AUTO_ARCHIVE_NO_ACCESS_DAYS = 60;

function ageDays(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Run decay + auto-archive + cap enforcement for a project.
 * Returns the number of memories archived.
 */
export function pruneProject(projectId: string): number {
  let archived = 0;

  // Step 1: Decay importance for old memories
  const active = listMemories({ projectId, isArchived: false });
  for (const mem of active) {
    const age = ageDays(mem.createdAt);
    if (age <= DECAY_GRACE_DAYS) continue;

    const accessBoost = Math.min(mem.accessCount * ACCESS_BOOST_PER_COUNT, MAX_ACCESS_BOOST);
    const decayAmount = DECAY_RATE_PER_DAY * (age - DECAY_GRACE_DAYS);
    const newImportance = Math.max(0, mem.importance - decayAmount + accessBoost);
    const clamped = Math.round(Math.min(10, Math.max(0, newImportance)));

    if (clamped !== mem.importance) {
      updateMemory({ id: mem.id, importance: clamped });
    }
  }

  // Step 2: Auto-archive low-importance, stale memories
  const toArchive: string[] = [];
  const refreshed = listMemories({ projectId, isArchived: false });
  for (const mem of refreshed) {
    if (mem.importance <= AUTO_ARCHIVE_THRESHOLD) {
      const lastAccess = mem.lastAccessedAt
        ? ageDays(mem.lastAccessedAt)
        : ageDays(mem.createdAt);
      if (lastAccess >= AUTO_ARCHIVE_NO_ACCESS_DAYS) {
        toArchive.push(mem.id);
      }
    }
  }

  if (toArchive.length > 0) {
    archiveMemories(toArchive);
    archived += toArchive.length;
  }

  // Step 3: Enforce cap — archive lowest-scoring if over limit
  archived += enforceCap(projectId);

  return archived;
}

/** Score a memory for cap enforcement (higher = keep) */
function scoreForCap(mem: Memory): number {
  const recency = Math.max(0, 1 - ageDays(mem.updatedAt) / 90);
  const importance = mem.importance / 10;
  const access = Math.min(mem.accessCount / 20, 1);
  return 0.4 * importance + 0.3 * recency + 0.3 * access;
}

function enforceCap(projectId: string): number {
  const count = countActiveMemories(projectId);
  if (count <= MAX_ACTIVE_MEMORIES) return 0;

  const excess = count - MAX_ACTIVE_MEMORIES;
  const active = listMemories({ projectId, isArchived: false });

  // Score and sort ascending (lowest score = first to archive)
  const scored = active.map((m) => ({ id: m.id, score: scoreForCap(m) }));
  scored.sort((a, b) => a.score - b.score);

  const idsToArchive = scored.slice(0, excess).map((s) => s.id);
  archiveMemories(idsToArchive);
  return idsToArchive.length;
}
