/**
 * Post-goal-creation memory extraction — analyzes goal name + description.
 * Fire-and-forget from IPC handler.
 */

import { extractMemories } from "./extractor.js";

export async function extractMemoriesFromGoal(
  projectId: string,
  goalId: string,
  name: string,
  description?: string,
): Promise<void> {
  const content = description
    ? `Goal: "${name}"\nDescription: ${description}`
    : `Goal: "${name}"`;

  if (content.length < 20) return;

  await extractMemories({
    projectId,
    goalId,
    sourceType: "goal",
    sourceId: goalId,
    content,
  });
}
