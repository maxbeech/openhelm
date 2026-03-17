/**
 * Post-job-creation memory extraction — analyzes job name + prompt.
 * Fire-and-forget from IPC handler.
 */

import { extractMemories } from "./extractor.js";

export async function extractMemoriesFromJob(
  projectId: string,
  jobId: string,
  name: string,
  prompt: string,
  goalId?: string,
  description?: string,
): Promise<void> {
  const parts: string[] = [`Job: "${name}"`];
  if (description) parts.push(`Description: ${description}`);
  parts.push(`Prompt: ${prompt}`);

  const content = parts.join("\n");
  if (content.length < 30) return;

  await extractMemories({
    projectId,
    goalId,
    jobId,
    sourceType: "job",
    sourceId: jobId,
    content,
  });
}
