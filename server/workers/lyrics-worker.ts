/**
 * Lyrics Worker
 *
 * Extracts lyrics from audio or metadata using Genius API.
 * Consumes jobs that have completed Demucs separation.
 * Transitions: DONE (demucs) → CLAIMED (lyrics) → RUNNING → DONE or FAILED
 *
 * Pattern:
 * 1. Find jobs with demucs DONE
 * 2. Claim for Lyrics extraction
 * 3. Execute lyrics extraction (Genius API with fallback to mock)
 * 4. Write lyrics as artifacts
 * 5. Transition to DONE or FAILED
 */

import { Job } from "bull";
import { createFilesystem } from "../lib/filesystem";
import { createMoveOperations } from "../lib/job-moves";
import { Actor } from "../lib/job-state";
import { JOB_STATES } from "../lib/filesystem";
import { getLyricsWithFallback } from "../lib/lyrics-api";

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

    await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Extracting lyrics via Genius API`);

    const title = metadata.download?.title || "Unknown";
    const artist = metadata.download?.artist || "Unknown";
    
    console.log(`[lyrics-worker] Fetching lyrics for "${title}" by "${artist}"`);
    const result = await getLyricsWithFallback(title, artist);

    if (!result.success) {
      // Step 5a: Fail the job (RUNNING → FAILED)
      console.log(`[lyrics-worker] Job ${jobId} failed: ${result.reason}`);
      await filesystem.appendToJobLog(
        jobId,
        `[LYRICS-WORKER] Extraction failed: ${result.reason} - ${result.error}`
      );

      // Update metadata with failure info
      const updated = await filesystem.readMetadata(jobId);
      if (updated) {
        updated.lyrics = {
          status: "FAILED",
          error: result.error,
          provider: result.source,
        };
        await filesystem.writeMetadata(jobId, updated);
      }

      await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      return;
    }

    // Step 5b: Complete the job (RUNNING → DONE)
    console.log(`[lyrics-worker] Job ${jobId} completed successfully (source: ${result.source})`);
    await filesystem.appendToJobLog(
      jobId,
      `[LYRICS-WORKER] Lyrics extraction complete (source: ${result.source}, confidence: ${result.confidence})`
    );

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
        confidence: result.confidence,
        provider: result.source,
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.DONE as any, Actor.SYSTEM);
    console.log(`[lyrics-worker] Job ${jobId} transitioned to DONE`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lyrics-worker] Job ${jobId} error:`, message);

    try {
      await filesystem.appendToJobLog(jobId, `[LYRICS-WORKER] Error: ${message}`);
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata) {
        metadata.lyrics = {
          status: "FAILED",
          error: message,
        };
        await filesystem.writeMetadata(jobId, metadata);
      }
    } catch (logError) {
      console.error(`[lyrics-worker] Failed to log error for job ${jobId}:`, logError);
    }
  }
}
