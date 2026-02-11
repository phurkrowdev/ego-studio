/**
 * yt-dlp Worker
 *
 * Downloads audio from YouTube using yt-dlp.
 * Transitions: NEW → CLAIMED → RUNNING → DONE or FAILED
 *
 * Pattern:
 * 1. Claim the job (NEW → CLAIMED)
 * 2. Start processing (CLAIMED → RUNNING)
 * 3. Execute yt-dlp (real binary)
 * 4. On success: transition to DONE and auto-enqueue Demucs
 * 5. On failure: transition to FAILED with reason
 *
 * All state transitions go through JobsService to maintain filesystem authority.
 * Logs are appended at every step.
 */

import { Job } from "bull";
import * as JobsService from "../lib/jobs-service";
import { filesystem } from "../lib/filesystem";
import { Actor } from "../lib/job-state";
import { createMoveOperations } from "../lib/job-moves";
import { enqueueDemucsJob } from "../lib/queue";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs-extra";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const moves = createMoveOperations(filesystem, STORAGE_ROOT);
const execFileAsync = promisify(execFile);

/**
 * Real yt-dlp execution
 * Streams output to job logs and returns title, artist, duration or failure reason
 */
async function executeYtDlp(
  youtubeUrl: string,
  jobId: string,
  jobDir: string
): Promise<{
  success: boolean;
  title?: string;
  artist?: string;
  duration?: number;
  error?: string;
  reason?: "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR";
}> {
  try {
    // Create output directory if it doesn't exist
    await fs.ensureDir(jobDir);

    const outputTemplate = path.join(jobDir, "audio.%(ext)s");

    // Log yt-dlp command
    await filesystem.appendToJobLog(
      jobId,
      `[YT-DLP] Command: yt-dlp "${youtubeUrl}" -o "${outputTemplate}" -f bestaudio`
    );

    // Execute yt-dlp with real binary
    try {
      const { stdout, stderr } = await execFileAsync("yt-dlp", [
        youtubeUrl,
        "-o",
        outputTemplate,
        "-f",
        "bestaudio",
        "--no-warnings",
        "--quiet",
      ]);

      // Log stdout/stderr
      if (stdout) {
        await filesystem.appendToJobLog(jobId, `[YT-DLP] ${stdout}`);
      }
      if (stderr) {
        await filesystem.appendToJobLog(jobId, `[YT-DLP] ${stderr}`);
      }

      // Extract metadata using yt-dlp
      const { stdout: metadataJson } = await execFileAsync("yt-dlp", [
        youtubeUrl,
        "-j",
        "--no-warnings",
        "--quiet",
      ]);

      const metadata = JSON.parse(metadataJson);
      const title = metadata.title || "Unknown Title";
      const artist = metadata.uploader || "Unknown Artist";
      const duration = metadata.duration || 0;

      await filesystem.appendToJobLog(
        jobId,
        `[YT-DLP] Downloaded: ${title} by ${artist} (${duration}s)`
      );

      return {
        success: true,
        title,
        artist,
        duration,
      };
    } catch (execError: any) {
      const errorMsg = execError.stderr || execError.message || String(execError);
      await filesystem.appendToJobLog(jobId, `[YT-DLP] Error: ${errorMsg}`);

      // Map error to failure reason
      let reason: "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR" =
        "DOWNLOAD_ERROR";

      if (errorMsg.includes("429") || errorMsg.includes("rate")) {
        reason = "RATE_LIMITED";
      } else if (errorMsg.includes("403") || errorMsg.includes("copyright")) {
        reason = "COPYRIGHT_RESTRICTED";
      } else if (errorMsg.includes("captcha") || errorMsg.includes("Captcha")) {
        reason = "CAPTCHA_REQUIRED";
      }

      return {
        success: false,
        error: errorMsg,
        reason,
      };
    }
  } catch (error) {
    const errorMsg = String(error);
    await filesystem.appendToJobLog(jobId, `[YT-DLP] Unexpected error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      reason: "DOWNLOAD_ERROR",
    };
  }
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

    await filesystem.appendToJobLog(jobId, `[WORKER] Downloading from: ${metadata.youtubeUrl}`);

    const jobDir = path.join(STORAGE_ROOT, "jobs", "RUNNING", jobId, "artifacts", "download");
    const result = await executeYtDlp(metadata.youtubeUrl, jobId, jobDir);

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

    // Write audio artifact marker
    try {
      await filesystem.writeArtifact(
        jobId,
        "download",
        "audio.downloaded",
        `Downloaded: ${result.title} by ${result.artist}`
      );
    } catch (artifactError) {
      console.error(`[yt-dlp-worker] Failed to write artifact for ${jobId}:`, artifactError);
    }

    // Move to DONE
    await moves.moveJob(jobId, "RUNNING" as any, "DONE" as any, Actor.DOWNLOAD_WORKER);

    // Auto-enqueue for Demucs processing
    try {
      console.log(`[yt-dlp-worker] Auto-enqueueing job ${jobId} for Demucs processing`);
      await filesystem.appendToJobLog(
        jobId,
        `[WORKER] Download complete, enqueueing for audio separation`
      );
      await enqueueDemucsJob(jobId);
      console.log(`[yt-dlp-worker] Job ${jobId} enqueued for Demucs`);
    } catch (enqueueError) {
      console.error(
        `[yt-dlp-worker] Failed to enqueue Demucs job for ${jobId}:`,
        enqueueError
      );
      await filesystem.appendToJobLog(
        jobId,
        `[WORKER] WARNING: Failed to enqueue for Demucs: ${String(enqueueError)}`
      );
    }

    console.log(`[yt-dlp-worker] Job ${jobId} finished successfully`);
  } catch (error) {
    console.error(`[yt-dlp-worker] Error processing job ${jobId}:`, error);

    // Log error
    try {
      await filesystem.appendToJobLog(jobId, `[WORKER] ERROR: ${String(error)}`);
    } catch (logError) {
      console.error(`[yt-dlp-worker] Failed to log error for job ${jobId}:`, logError);
    }

    // Try to mark as failed if not already
    try {
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata && metadata.state === "RUNNING") {
        await moves.moveJob(jobId, "RUNNING" as any, "FAILED" as any, Actor.DOWNLOAD_WORKER);
      }
    } catch (failError) {
      console.error(`[yt-dlp-worker] Failed to mark job as failed:`, failError);
    }

    throw error;
  }
}

/**
 * Configure Bull job options
 */
export const YT_DLP_QUEUE_NAME = "yt-dlp-downloads";
export const DEMUCS_QUEUE_NAME = "demucs-separation";

export const JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000,
  },
  removeOnComplete: false,
  removeOnFail: false,
};
