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
 * 3. Execute Demucs (real execFile)
 * 4. Write stems as artifacts
 * 5. Transition to DONE or FAILED
 */

import { Job } from "bull";
import { execFile } from "child_process";
import { promisify } from "util";
import { createFilesystem } from "../lib/filesystem";
import { createMoveOperations } from "../lib/job-moves";
import { Actor } from "../lib/job-state";
import { JOB_STATES } from "../lib/filesystem";
import * as fs from "fs-extra";
import * as path from "path";

const execFileAsync = promisify(execFile);

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
 * Real Demucs execution
 * Returns stems or failure with error mapping
 */
async function executeDemucs(audioPath: string, outputDir: string): Promise<{
  success: boolean;
  stems?: Record<string, string>;
  error?: string;
  reason?: string;
}> {
  try {
    // Ensure output directory exists
    await fs.ensureDir(outputDir);

    // Execute demucs command
    // demucs -o <output_dir> <audio_file>
    const { stdout, stderr } = await execFileAsync("demucs", ["-o", outputDir, audioPath], {
      timeout: 600000, // 10 minutes
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    // Log output
    if (stdout) console.log(`[demucs-worker] stdout: ${stdout}`);
    if (stderr) console.log(`[demucs-worker] stderr: ${stderr}`);

    // Find generated stem files
    const stemDir = path.join(outputDir, "htdemucs", path.basename(audioPath, path.extname(audioPath)));
    const stems: Record<string, string> = {};

    if (await fs.pathExists(stemDir)) {
      const stemFiles = await fs.readdir(stemDir);
      for (const file of stemFiles) {
        const stemPath = path.join(stemDir, file);
        const stemName = path.basename(file, path.extname(file));
        stems[stemName] = stemPath;
      }
    }

    if (Object.keys(stems).length === 0) {
      return {
        success: false,
        error: "No stems generated",
        reason: "NO_STEMS_GENERATED",
      };
    }

    return {
      success: true,
      stems,
    };
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    const stderr = error.stderr || "";

    // Map errors to failure reasons
    let reason = "DEMUCS_ERROR";
    if (errorMsg.includes("CUDA out of memory") || stderr.includes("out of memory")) {
      reason = "GPU_MEMORY";
    } else if (errorMsg.includes("timeout") || stderr.includes("timeout")) {
      reason = "TIMEOUT";
    } else if (errorMsg.includes("Invalid data") || stderr.includes("Invalid audio")) {
      reason = "INVALID_AUDIO_FORMAT";
    }

    return {
      success: false,
      error: `Demucs execution failed: ${errorMsg}`,
      reason,
    };
  }
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
      console.log(`[demucs-worker] Claiming job ${jobId} for Demucs processing`);
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Claiming job for audio separation`);
      await moves.moveJob(jobId, JOB_STATES.DONE as any, JOB_STATES.CLAIMED as any, Actor.SYSTEM);
    }

    // Step 3: Start processing (CLAIMED → RUNNING)
    metadata = await filesystem.readMetadata(jobId);
    if (metadata?.state === JOB_STATES.CLAIMED) {
      console.log(`[demucs-worker] Starting Demucs for job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Starting audio separation`);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED as any, JOB_STATES.RUNNING as any, Actor.SYSTEM);
    }

    // Step 4: Execute Demucs
    console.log(`[demucs-worker] Executing Demucs for job ${jobId}`);
    metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job metadata lost for ${jobId}`);
    }

    await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Executing Demucs`);

    // Get audio file path from download metadata
    const audioPath = metadata.download?.filePath || `${jobId}.audio.wav`;
    const jobDir = path.join(STORAGE_ROOT, jobId);
    const outputDir = path.join(jobDir, "demucs-output");

    const result = await executeDemucs(audioPath, outputDir);

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

      await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      return;
    }

    // Step 5b: Complete the job (RUNNING → DONE)
    console.log(`[demucs-worker] Job ${jobId} completed successfully`);
    await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Audio separation complete`);

    // Write stem artifacts
    if (result.stems) {
      for (const [stemName, stemPath] of Object.entries(result.stems)) {
        try {
          const content = await fs.readFile(stemPath);
          await filesystem.writeArtifact(jobId, "stems", `${stemName}.wav`, content);
          await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Wrote artifact: ${stemName}.wav`);
        } catch (artifactError) {
          console.error(`[demucs-worker] Failed to write artifact ${stemName}:`, artifactError);
          await filesystem.appendToJobLog(jobId, `[DEMUCS-WORKER] Warning: Failed to write artifact ${stemName}`);
        }
      }
    }

    // Update metadata with success info
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.separation = {
        status: "COMPLETE",
        model: "htdemucs",
        device: "cpu", // or detect from environment
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.DONE as any, Actor.SYSTEM);

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
        await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      }
    } catch (failError) {
      console.error(`[demucs-worker] Failed to mark job as failed:`, failError);
    }

    throw error;
  }
}
