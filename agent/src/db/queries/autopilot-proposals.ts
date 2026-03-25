import { eq, and } from "drizzle-orm";
import { getDb } from "../init.js";
import { autopilotProposals } from "../schema.js";
import type {
  AutopilotProposal,
  AutopilotProposalStatus,
  PlannedSystemJob,
} from "@openhelm/shared";

function rowToProposal(
  row: typeof autopilotProposals.$inferSelect,
): AutopilotProposal {
  return {
    id: row.id,
    goalId: row.goalId,
    projectId: row.projectId,
    status: row.status as AutopilotProposalStatus,
    plannedJobs: JSON.parse(row.plannedJobs) as PlannedSystemJob[],
    reason: row.reason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export function createProposal(params: {
  goalId: string;
  projectId: string;
  plannedJobs: PlannedSystemJob[];
  reason: string;
}): AutopilotProposal {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const row = db
    .insert(autopilotProposals)
    .values({
      id,
      goalId: params.goalId,
      projectId: params.projectId,
      plannedJobs: JSON.stringify(params.plannedJobs),
      reason: params.reason,
      createdAt: now,
    })
    .returning()
    .get();

  return rowToProposal(row);
}

export function getProposal(id: string): AutopilotProposal | null {
  const db = getDb();
  const row = db
    .select()
    .from(autopilotProposals)
    .where(eq(autopilotProposals.id, id))
    .get();
  return row ? rowToProposal(row) : null;
}

export function listProposals(params?: {
  projectId?: string;
  status?: AutopilotProposalStatus;
}): AutopilotProposal[] {
  const db = getDb();
  const conditions = [];

  if (params?.projectId) {
    conditions.push(eq(autopilotProposals.projectId, params.projectId));
  }
  if (params?.status) {
    conditions.push(eq(autopilotProposals.status, params.status));
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(autopilotProposals)
          .where(and(...conditions))
          .all()
      : db.select().from(autopilotProposals).all();

  return rows.map(rowToProposal);
}

export function updateProposalStatus(
  id: string,
  status: AutopilotProposalStatus,
): AutopilotProposal {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(autopilotProposals)
    .set({
      status,
      resolvedAt: status === "pending" ? null : now,
    })
    .where(eq(autopilotProposals.id, id))
    .returning()
    .get();

  if (!row) throw new Error(`Proposal not found: ${id}`);
  return rowToProposal(row);
}

/** Expire all pending proposals (used when autopilot is turned off) */
export function expireAllPendingProposals(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(autopilotProposals)
    .set({ status: "expired", resolvedAt: now })
    .where(eq(autopilotProposals.status, "pending"))
    .run();
}
