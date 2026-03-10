import { getDb } from "../db/init.js";
import { createGoal } from "../db/queries/goals.js";
import { createJob } from "../db/queries/jobs.js";
import { getProject } from "../db/queries/projects.js";
import { computeNextFireAt } from "../scheduler/schedule.js";
import type {
  PlannedJob,
  CommitPlanResult,
  ScheduleConfigOnce,
} from "@openorchestra/shared";

/**
 * Commit an approved plan to the database atomically.
 * Creates a goal and all associated jobs in a single transaction.
 *
 * For once-jobs, nextFireAt is set to now (scheduler picks up next tick).
 * For recurring jobs, nextFireAt is computed forward from current time.
 */
export function commitPlan(
  projectId: string,
  goalDescription: string,
  plannedJobs: PlannedJob[],
): CommitPlanResult {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (plannedJobs.length === 0) {
    throw new Error("Cannot commit an empty plan");
  }

  const db = getDb();

  // Use raw SQL transaction for atomicity
  const result = db.transaction((tx) => {
    // Create the goal
    const goal = createGoal({
      projectId,
      name: goalDescription,
      description: goalDescription,
    });

    // Create each job with corrected nextFireAt
    const jobIds: string[] = [];
    for (const planned of plannedJobs) {
      const adjustedConfig = adjustScheduleConfig(planned);

      const job = createJob({
        projectId,
        goalId: goal.id,
        name: planned.name,
        description: planned.description,
        prompt: planned.prompt,
        scheduleType: planned.scheduleType,
        scheduleConfig: adjustedConfig,
        isEnabled: true,
      });

      jobIds.push(job.id);
    }

    return { goalId: goal.id, jobIds };
  });

  return result;
}

// Buffer added so computeNextFireAt (called inside createJob) still sees a
// future timestamp. Without this, fireAt=now is already in the past by the
// time createJob runs, returning nextFireAt=null and silently skipping the job.
const ONCE_FIRE_BUFFER_MS = 10_000; // 10 seconds — picked up on next scheduler tick

/**
 * Adjust schedule config to ensure correct nextFireAt behavior:
 * - once-jobs: set fireAt slightly in the future so createJob's
 *   computeNextFireAt call returns a non-null nextFireAt
 * - interval/cron: leave as-is (computeNextFireAt handles forward calculation)
 */
function adjustScheduleConfig(planned: PlannedJob): PlannedJob["scheduleConfig"] {
  if (planned.scheduleType === "once") {
    return { fireAt: new Date(Date.now() + ONCE_FIRE_BUFFER_MS).toISOString() } satisfies ScheduleConfigOnce;
  }
  return planned.scheduleConfig;
}
