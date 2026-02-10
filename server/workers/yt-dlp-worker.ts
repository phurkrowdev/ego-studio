/**
 * yt-dlp Worker
 *
 * Bull queue processor that:
 * 1. Claims jobs (NEW → CLAIMED)
 * 2. Starts processing (CLAIMED → RUNNING)
 * 3. Calls yt-dlp (mocked for now)
 * 4. Completes or fails (RUNNING → DONE/FAILED)
 *
 * All state transitions go through JobsService to maintain filesystem authority.
 * Logs are appended at every step.
 */

import { Job } from "bull";
import * as JobsService from "../lib/jobs-service";
import { filesystem } from "../lib/filesystem";
import { Actor } from "../lib/job-state";
import { createMoveOperations } from "../lib/job-moves";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const moves = createMoveOperations(filesystem, STORAGE_ROOT);

/**
 * Mock yt-dlp call (replace with real yt-dlp invocation)
 */
async function mockYtDlpDownload(youtubeUrl: string): Promise<{
  success: boolean;
  title?: string;
  artist?: string;
  duration?: number;
  error?: string;
  reason?: "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR";
}> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Mock failure scenarios (10% chance)
  const random = Math.random();
  if (random < 0.1) {
    const reasons: Array<
      "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR"
    > = ["CAPTCHA_REQUIRED", "RATE_LIMITED", "COPYRIGHT_RESTRICTED", "DOWNLOAD_ERROR"];
    const reason = reasons[Math.floor(Math.random() * reasons.length)];
    return {
      success: false,
      error: `Download failed: ${reason}`,
      reason,
    };
  }

  // Mock success
  return {
    success: true,
    title: "Example Song",
    artist: "Example Artist",
    duration: 180,
  };
}

/**
 * Process a single job
 */
export async function processYtDlpJob(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data as { jobId: string };

  try {
    console.log(`[yt-dlp-worker] Processing job ${jobId}`);

    // Step 1: Claim the job (NEW → CLAIMED)
    let metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (metadata.state === "NEW") {
      console.log(`[yt-dlp-worker] Claiming job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[WORKER] Claiming job for download`);
      await moves.moveJob(jobId, "NEW" as any, "CLAIMED" as any, Actor.DOWNLOAD_WORKER);
    }

    // Step 2: Start processing (CLAIMED → RUNNING)
    metadata = await filesystem.readMetadata(jobId);
    if (metadata?.state === "CLAIMED") {
      console.log(`[yt-dlp-worker] Starting job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[WORKER] Starting yt-dlp download`);
      await moves.moveJob(jobId, "CLAIMED" as any, "RUNNING" as any, Actor.DOWNLOAD_WORKER);
    }

    // Step 3: Call yt-dlp
    console.log(`[yt-dlp-worker] Calling yt-dlp for job ${jobId}`);
    metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job metadata lost for ${jobId}`);
    }

    await filesystem.appendToJobLog(
      jobId,
      `[WORKER] Downloading from: ${metadata.youtubeUrl}`
    );

    const result = await mockYtDlpDownload(metadata.youtubeUrl);

    if (!result.success) {
      // Step 4a: Fail the job (RUNNING → FAILED)
      console.log(`[yt-dlp-worker] Job ${jobId} failed: ${result.reason}`);
      await filesystem.appendToJobLog(
        jobId,
        `[WORKER] Download failed: ${result.reason} - ${result.error}`
      );

      // Update metadata with failure info
      const updated = await filesystem.readMetadata(jobId);
      if (updated) {
        updated.download = {
          status: "FAILED",
          reason: result.reason,
          message: result.error,
        };
        await filesystem.writeMetadata(jobId, updated);
      }

      // Move to FAILED
      await moves.moveJob(jobId, "RUNNING" as any, "FAILED" as any, Actor.DOWNLOAD_WORKER);
      return;
    }

    // Step 4b: Complete the job (RUNNING → DONE)
    console.log(`[yt-dlp-worker] Job ${jobId} completed successfully`);
    await filesystem.appendToJobLog(
      jobId,
      `[WORKER] Download complete: ${result.title} by ${result.artist}`
    );

    // Update metadata with success info
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.download = {
        status: "COMPLETE",
        title: result.title,
        artist: result.artist,
        duration: result.duration,
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    // Move to DONE
    await moves.moveJob(jobId, "RUNNING" as any, "DONE" as any, Actor.DOWNLOAD_WORKER);

    console.log(`[yt-dlp-worker] Job ${jobId} finished successfully`);
  } catch (error) {
    console.error(`[yt-dlp-worker] Error processing job ${jobId}:`, error);

    // Log error
    try {
      await filesystem.appendToJobLog(jobId, `[WORKER] ERROR: ${String(error)}`);
    } catch (logError) {
      console.error(`[yt-dlp-worker] Failed to log error for job ${jobId}:`, logError);
    }

    // Try to transition to FAILED if not already
    try {
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata && metadata.state !== "FAILED" && metadata.state !== "DONE") {
        const updated = await filesystem.readMetadata(jobId);
        if (updated) {
          updated.download = {
            status: "FAILED",
            message: String(error),
          };
          await filesystem.writeMetadata(jobId, updated);
        }

        await moves.moveJob(
          jobId,
          metadata.state as any,
          "FAILED" as any,
          Actor.DOWNLOAD_WORKER
        );
      }
    } catch (failError) {
      console.error(`[yt-dlp-worker] Failed to mark job ${jobId} as failed:`, failError);
    }

    // Re-throw to let Bull handle retry logic
    throw error;
  }
}

/**
 * Configure Bull job options
 */
export const YT_DLP_QUEUE_NAME = "yt-dlp-downloads";

export const JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: false,
  removeOnFail: false,
};
