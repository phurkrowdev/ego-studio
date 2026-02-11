/**
 * Demucs Worker
 *
 * Processes audio separation using Demucs.
 * Consumes jobs that have completed yt-dlp download.
 * Transitions: DONE (download) → CLAIMED (demucs) → RUNNING → DONE or FAILED
 *
 * Pattern:
 * 1. Find jobs with download DONE
 * 2. Claim for Demucs processing
 * 3. Execute Demucs (mock first)
 * 4. Write stems as artifacts
 * 5. Transition to DONE or FAILED
 */

import { Job } from "bull";
import { createFilesystem } from "../lib/filesystem";
import { createMoveOperations } from "../lib/job-moves";
import { Actor } from "../lib/job-state";
import { JOB_STATES } from "../lib/filesystem";

export const DEMUCS_QUEUE_NAME = "demucs-processing";

export const JOB_OPTIONS = {
  attempts: 1,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: false,
  removeOnFail: false,
};

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const filesystem = createFilesystem(STORAGE_ROOT);
const moves = createMoveOperations(filesystem, STORAGE_ROOT);

/**
 * Mock Demucs execution
 * Returns stems or failure
 */
async function mockDemucsExecution(audioPath: string): Promise<{
  success: boolean;
  stems?: Record<string, string>;
  error?: string;
  reason?: string;
}> {
  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 5% failure rate
  if (Math.random() < 0.05) {
    const reasons = ["DEMUCS_ERROR", "AUDIO_CORRUPT", "PROCESSING_TIMEOUT"];
    const reason = reasons[Math.floor(Math.random() * reasons.length)];
    return {
      success: false,
      error: `Demucs processing failed: ${reason}`,
      reason,
    };
  }

  // Success: return mock stem paths
  return {
    success: true,
    stems: {
      vocals: `${audioPath}.vocals.wav`,
      drums: `${audioPath}.drums.wav`,
      bass: `${audioPath}.bass.wav`,
      other: `${audioPath}.other.wav`,
    },
  };
}

/**
 * Process a single Demucs job
 */
export async function processDemucsJob(job: Job<{ jobId: string }>): Promise<void> {
  const { jobId } = job.data as { jobId: string };

  try {
    console.log(`[demucs-worker] Processing job ${jobId}`);

    // Step 1: Check if job is ready for Demucs (download completed)
    let metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Only process jobs with successful download
    if (metadata.download?.status !== "COMPLETE") {
      console.log(
        `[demucs-worker] Skipping job ${jobId}: download not complete (status: ${metadata.download?.status})`
      );
      return;
    }

    // Step 2: Claim job for Demucs processing (DONE → CLAIMED)
    if (metadata.state === JOB_STATES.DONE) {
      console.log(`[demucs-worker] Claiming job ${jobId} for Demucs`);
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Claiming job for audio separation`);
      await moves.moveJob(jobId, JOB_STATES.DONE as any, JOB_STATES.CLAIMED as any, Actor.DEMUCS_WORKER);
    }

    // Step 3: Start processing (CLAIMED → RUNNING)
    metadata = await filesystem.readMetadata(jobId);
    if (metadata?.state === JOB_STATES.CLAIMED) {
      console.log(`[demucs-worker] Starting Demucs for job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Starting audio separation`);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED as any, JOB_STATES.RUNNING as any, Actor.DEMUCS_WORKER);
    }

    // Step 4: Execute Demucs
    console.log(`[demucs-worker] Executing Demucs for job ${jobId}`);
    metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job metadata lost for ${jobId}`);
    }

    await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Processing audio with Demucs`);

    // Mock audio path (in real implementation, would be actual downloaded file)
    const audioPath = `/tmp/ego-studio-jobs/jobs/DONE/${jobId}/artifacts/download/audio.wav`;

    const result = await mockDemucsExecution(audioPath);

    if (!result.success) {
      // Step 5a: Fail the job (RUNNING → FAILED)
      console.log(`[demucs-worker] Job ${jobId} failed: ${result.reason}`);
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Separation failed: ${result.reason}`);

      // Update metadata with failure info
      const updated = await filesystem.readMetadata(jobId);
      if (updated) {
        updated.separation = {
          status: "FAILED",
          error: result.error,
        };
        await filesystem.writeMetadata(jobId, updated);
      }

      await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.DEMUCS_WORKER);
      return;
    }

    // Step 5b: Complete the job (RUNNING → DONE)
    console.log(`[demucs-worker] Job ${jobId} completed successfully`);
    await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Audio separation complete`);

    // Write stem artifacts
    if (result.stems) {
      for (const [stemName, stemPath] of Object.entries(result.stems)) {
        await filesystem.writeArtifact(jobId, "separation", `${stemName}.wav`, `Mock stem: ${stemPath}`);
        await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Wrote artifact: ${stemName}.wav`);
      }
    }

    // Update metadata with success info
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.separation = {
        status: "COMPLETE",
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.DONE as any, Actor.DEMUCS_WORKER);

    console.log(`[demucs-worker] Job ${jobId} finished successfully`);
  } catch (error) {
    console.error(`[demucs-worker] Error processing job ${jobId}:`, error);

    // Log error
    try {
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] ERROR: ${String(error)}`);
    } catch (logError) {
      console.error(`[demucs-worker] Failed to log error for job ${jobId}:`, logError);
    }

    // Try to mark as failed if not already
    try {
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata && metadata.state === JOB_STATES.RUNNING) {
        await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.DEMUCS_WORKER);
      }
    } catch (failError) {
      console.error(`[demucs-worker] Failed to mark job as failed:`, failError);
    }

    throw error;
  }
}
