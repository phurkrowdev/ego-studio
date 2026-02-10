/**
 * Retry Logic for JobsService
 *
 * Extends JobsService with retry functionality.
 * Allows users to retry failed jobs (FAILED → NEW).
 */

import { filesystem } from "./filesystem";
import { createMoveOperations } from "./job-moves";
import { Actor } from "./job-state";
import { JOB_STATES } from "./filesystem";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const moves = createMoveOperations(filesystem, STORAGE_ROOT);

/**
 * Retry a failed job
 * Transitions FAILED → NEW with reason logged
 */
export async function retryJob(jobId: string, reason: string = "User retry"): Promise<{
  jobId: string;
  state: string;
  message: string;
}> {
  const metadata = await filesystem.readMetadata(jobId);

  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (metadata.state !== JOB_STATES.FAILED) {
    throw new Error(`Cannot retry job in state ${metadata.state}. Only FAILED jobs can be retried.`);
  }

  console.log(`[JobsService.retryJob] Retrying job ${jobId} with reason: ${reason}`);

  // Log the retry
  await filesystem.appendToJobLog(jobId, `[USER] Retrying job: ${reason}`);

  // Transition FAILED → NEW
  await moves.moveJob(jobId, JOB_STATES.FAILED as any, JOB_STATES.NEW as any, Actor.USER);

  // Clear previous failure info
  const updated = await filesystem.readMetadata(jobId);
  if (updated) {
    updated.download = undefined;
    await filesystem.writeMetadata(jobId, updated);
  }

  console.log(`[JobsService.retryJob] Job ${jobId} reset to NEW state`);

  return {
    jobId,
    state: JOB_STATES.NEW,
    message: `Job ${jobId} has been reset and will be retried`,
  };
}
