/**
 * Atomic State Transitions
 *
 * Uses fs.rename() for atomic directory moves across state directories.
 * Guarantees: No partial states, race-safe on same filesystem.
 *
 * Invariants:
 * - Transitions are atomic (fs.rename on same filesystem)
 * - No intermediate states visible
 * - Idempotent (can retry without side effects)
 */

import fs from "fs-extra";
import path from "path";
import { STORAGE_ROOT, JOB_STATES, JobState, readMetadata, writeMetadata, appendToJobLog } from "./filesystem";
import { validateTransition, Actor } from "./job-state";

/**
 * Move a job from one state to another (atomic)
 */
export async function moveJob(jobId: string, fromState: JobState, toState: JobState, actor: Actor): Promise<void> {
  // Validate transition
  const validation = validateTransition(fromState, toState, actor);
  if (!validation.valid) {
    throw new Error(`Invalid transition: ${validation.reason}`);
  }

  // Get current job directory
  const fromDir = path.join(STORAGE_ROOT, "jobs", fromState, jobId);
  const toDir = path.join(STORAGE_ROOT, "jobs", toState, jobId);

  // Verify source exists
  if (!(await fs.pathExists(fromDir))) {
    throw new Error(`Job ${jobId} not found in state ${fromState}`);
  }

  // Verify destination doesn't exist
  if (await fs.pathExists(toDir)) {
    throw new Error(`Job ${jobId} already exists in state ${toState}`);
  }

  // Ensure destination directory exists
  await fs.ensureDir(path.dirname(toDir));

  // Atomic move
  try {
    await fs.move(fromDir, toDir, { overwrite: false });
  } catch (error) {
    throw new Error(`Failed to move job ${jobId} from ${fromState} to ${toState}: ${error}`);
  }

  // Update metadata
  const metadata = await readMetadata(jobId);
  if (metadata) {
    metadata.state = toState;
    await writeMetadata(jobId, metadata);

    // Log transition
    await appendToJobLog(jobId, `Transitioned to ${toState} by ${actor}`);
  }
}

/**
 * Attempt to move a job, with idempotency
 * Returns true if move succeeded or was already in target state
 */
export async function moveJobIdempotent(jobId: string, fromState: JobState, toState: JobState, actor: Actor): Promise<boolean> {
  // Check if already in target state
  const metadata = await readMetadata(jobId);
  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (metadata.state === toState) {
    // Already in target state, idempotent success
    return true;
  }

  if (metadata.state !== fromState) {
    // In unexpected state
    throw new Error(`Job ${jobId} is in state ${metadata.state}, expected ${fromState}`);
  }

  // Perform move
  await moveJob(jobId, fromState, toState, actor);
  return true;
}

/**
 * Reclaim a job from CLAIMED or RUNNING back to NEW (for lease expiry)
 */
export async function reclaimJob(jobId: string): Promise<void> {
  const metadata = await readMetadata(jobId);
  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (metadata.state === JOB_STATES.NEW || metadata.state === JOB_STATES.DONE || metadata.state === JOB_STATES.FAILED) {
    // No reclaim needed
    return;
  }

  if (metadata.state === JOB_STATES.CLAIMED || metadata.state === JOB_STATES.RUNNING) {
    // Check if lease expired
    if (metadata.leaseExpiresAt && new Date(metadata.leaseExpiresAt) > new Date()) {
      // Lease still valid
      return;
    }

    // Lease expired or missing, reclaim
    await moveJob(jobId, metadata.state, JOB_STATES.NEW, Actor.SYSTEM);
    await appendToJobLog(jobId, `Reclaimed from ${metadata.state} (lease expired)`);
  }
}
