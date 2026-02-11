/**
 * Lyrics Worker
 *
 * Extracts lyrics from audio or metadata.
 * Consumes jobs that have completed Demucs separation.
 * Transitions: DONE (demucs) → CLAIMED (lyrics) → RUNNING → DONE or FAILED
 *
 * Pattern:
 * 1. Find jobs with demucs DONE
 * 2. Claim for Lyrics extraction
 * 3. Execute lyrics extraction (mock first, real API later)
 * 4. Write lyrics as artifacts
 * 5. Transition to DONE or FAILED
 */

import { Job } from "bull";
import { createFilesystem } from "../lib/filesystem";
import { createMoveOperations } from "../lib/job-moves";
import { Actor } from "../lib/job-state";
import { JOB_STATES } from "../lib/filesystem";

export const LYRICS_QUEUE_NAME = "lyrics-extraction";

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
 * Mock lyrics extraction
 * Returns lyrics or failure
 */
async function mockLyricsExtraction(title: string): Promise<{
  success: boolean;
  lyrics?: string;
  error?: string;
  reason?: string;
}> {
  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 5% failure rate
  if (Math.random() < 0.05) {
    return {
      success: false,
      error: "Lyrics not found",
      reason: "NOT_FOUND",
    };
  }

  // Success: return mock lyrics
  return {
    success: true,
    lyrics: `[00:00] Verse 1\n[00:15] Chorus\n[00:30] Verse 2\n[00:45] Chorus\n[01:00] Bridge\n[01:15] Chorus\nFor: ${title}`,
  };
}

/**
 * Process a single Lyrics job
 */
export async function processLyricsJob(job: Job<{ jobId: string }>): Promise<void> {
  const { jobId } = job.data as { jobId: string };

  try {
    console.log(`[lyrics-worker] Processing job ${jobId}`);

    // Step 1: Check if job is ready for Lyrics (demucs completed)
    let metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Only process jobs with successful demucs
    if (metadata.separation?.status !== "COMPLETE") {
      console.log(
        `[lyrics-worker] Skipping job ${jobId}: demucs not complete (status: ${metadata.separation?.status})`
      );
      return;
    }

    // Step 2: Claim job for Lyrics processing (DONE → CLAIMED)
    if (metadata.state === JOB_STATES.DONE) {
      console.log(`[lyrics-worker] Claiming job ${jobId} for Lyrics extraction`);
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Claiming job for lyrics extraction`);
      await moves.moveJob(jobId, JOB_STATES.DONE as any, JOB_STATES.CLAIMED as any, Actor.SYSTEM);
    }

    // Step 3: Start processing (CLAIMED → RUNNING)
    metadata = await filesystem.readMetadata(jobId);
    if (metadata?.state === JOB_STATES.CLAIMED) {
      console.log(`[lyrics-worker] Starting Lyrics for job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Starting lyrics extraction`);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED as any, JOB_STATES.RUNNING as any, Actor.SYSTEM);
    }

    // Step 4: Execute Lyrics extraction
    console.log(`[lyrics-worker] Extracting lyrics for job ${jobId}`);
    metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job metadata lost for ${jobId}`);
    }

    await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Extracting lyrics`);

    const title = metadata.download?.title || "Unknown";
    const result = await mockLyricsExtraction(title);

    if (!result.success) {
      // Step 5a: Fail the job (RUNNING → FAILED)
      console.log(`[lyrics-worker] Job ${jobId} failed: ${result.reason}`);
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Extraction failed: ${result.reason}`);

      // Update metadata with failure info
      const updated = await filesystem.readMetadata(jobId);
      if (updated) {
        updated.lyrics = {
          status: "FAILED",
          error: result.error,
        };
        await filesystem.writeMetadata(jobId, updated);
      }

      await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      return;
    }

    // Step 5b: Complete the job (RUNNING → DONE)
    console.log(`[lyrics-worker] Job ${jobId} completed successfully`);
    await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Lyrics extraction complete`);

    // Write lyrics artifact
    if (result.lyrics) {
      await filesystem.writeArtifact(jobId, "lyrics", "lyrics.lrc", result.lyrics);
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Wrote artifact: lyrics.lrc`);
    }

    // Update metadata with success info
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.lyrics = {
        status: "COMPLETE",
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.DONE as any, Actor.SYSTEM);

    console.log(`[lyrics-worker] Job ${jobId} finished successfully`);
  } catch (error) {
    console.error(`[lyrics-worker] Error processing job ${jobId}:`, error);

    // Log error
    try {
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] ERROR: ${String(error)}`);
    } catch (logError) {
      console.error(`[lyrics-worker] Failed to log error for job ${jobId}:`, logError);
    }

    // Try to mark as failed if not already
    try {
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata && metadata.state === JOB_STATES.RUNNING) {
        await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      }
    } catch (failError) {
      console.error(`[lyrics-worker] Failed to mark job as failed:`, failError);
    }

    throw error;
  }
}
