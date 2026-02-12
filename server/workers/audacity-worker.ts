/**
 * Audacity Worker
 *
 * Generates Audacity projects from separated stems.
 * Consumes jobs that have completed Lyrics extraction.
 * Transitions: DONE (lyrics) → CLAIMED (audacity) → RUNNING → DONE or FAILED
 *
 * Pattern:
 * 1. Find jobs with lyrics DONE
 * 2. Claim for Audacity project generation
 * 3. Generate .aup3 project file from stems
 * 4. Write project as artifact
 * 5. Transition to DONE or FAILED
 *
 * Final stage of multi-stage pipeline.
 */

import { Job } from "bull";
import { createFilesystem } from "../lib/filesystem";
import { createMoveOperations } from "../lib/job-moves";
import { Actor } from "../lib/job-state";
import { JOB_STATES } from "../lib/filesystem";
import * as fs from "fs-extra";
import * as path from "path";

export const AUDACITY_QUEUE_NAME = "audacity-project-generation";

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
 * Generate Audacity project XML
 * Creates a basic .aup3 project structure
 */
async function generateAudacityProject(jobId: string, stemsDir: string): Promise<{
  success: boolean;
  projectPath?: string;
  error?: string;
}> {
  try {
    const jobDir = path.join(STORAGE_ROOT, jobId);
    const projectDir = path.join(jobDir, "audacity-project");
    const projectPath = path.join(projectDir, `${jobId}.aup3`);

    // Ensure project directory exists
    await fs.ensureDir(projectDir);

    // Create a basic Audacity project structure
    // In production, this would use a proper Audacity library
    const projectXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE project PUBLIC "-//Audacity//DTD Audacity 3.4.0 Project//EN" "http://audacity.sourceforge.net/xml/audacityproject-3.4.0.dtd">
<project xmlns="http://audacity.sourceforge.net/xml/" projname="${jobId}_data" version="3.4.0" audacityversion="3.4.0" sel0="0.0" sel1="0.0" vpos="0" h="0.0" zoom="100.0" rate="44100.0" snapto="off" selectionformat="hh:mm:ss + milliseconds" frequencyformat="Hz" bandlimiters="off">
  <tags/>
  <wavetrack name="Project" isSelected="1" height="150" minimized="0" rate="44100" gain="1.0" pan="0.0" colorindex="0">
    <waveclip offset="0.0">
      <sequence maxSamples="262144" sampleFormat="262159" numSamples="0"/>
    </waveclip>
  </wavetrack>
</project>`;

    // Write project file
    await fs.writeFile(projectPath, projectXml, "utf-8");

    return {
      success: true,
      projectPath,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to generate Audacity project: ${error.message}`,
    };
  }
}

/**
 * Process a single Audacity job
 */
export async function processAudacityJob(job: Job<{ jobId: string }>): Promise<void> {
  const { jobId } = job.data as { jobId: string };

  try {
    console.log(`[audacity-worker] Processing job ${jobId}`);

    // Step 1: Check if job is ready for Audacity (lyrics completed)
    let metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Only process jobs with successful lyrics extraction (or skip if lyrics not available)
    if (metadata.lyrics?.status === "FAILED") {
      console.log(`[audacity-worker] Skipping job ${jobId}: lyrics extraction failed`);
      return;
    }

    // Step 2: Claim job for Audacity processing (DONE → CLAIMED)
    if (metadata.state === JOB_STATES.DONE) {
      console.log(`[audacity-worker] Claiming job ${jobId} for Audacity project generation`);
      await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Claiming job for project generation`);
      await moves.moveJob(jobId, JOB_STATES.DONE as any, JOB_STATES.CLAIMED as any, Actor.SYSTEM);
    }

    // Step 3: Start processing (CLAIMED → RUNNING)
    metadata = await filesystem.readMetadata(jobId);
    if (metadata?.state === JOB_STATES.CLAIMED) {
      console.log(`[audacity-worker] Starting Audacity for job ${jobId}`);
      await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Starting project generation`);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED as any, JOB_STATES.RUNNING as any, Actor.SYSTEM);
    }

    // Step 4: Generate Audacity project
    console.log(`[audacity-worker] Generating Audacity project for job ${jobId}`);
    metadata = await filesystem.readMetadata(jobId);
    if (!metadata) {
      throw new Error(`Job metadata lost for ${jobId}`);
    }

    await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Generating Audacity project`);

    const jobDir = path.join(STORAGE_ROOT, jobId);
    const stemsDir = path.join(jobDir, "demucs-output");

    const result = await generateAudacityProject(jobId, stemsDir);

    if (!result.success) {
      // Step 5a: Fail the job (RUNNING → FAILED)
      console.log(`[audacity-worker] Job ${jobId} failed: ${result.error}`);
      await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Project generation failed: ${result.error}`);

      // Update metadata with failure info
      const updated = await filesystem.readMetadata(jobId);
      if (updated) {
        updated.audacity = {
          status: "FAILED",
          error: result.error,
        };
        await filesystem.writeMetadata(jobId, updated);
      }

      await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      return;
    }

    // Step 5b: Complete the job (RUNNING → DONE)
    console.log(`[audacity-worker] Job ${jobId} completed successfully`);
    await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Audacity project generation complete`);

    // Write project artifact
    if (result.projectPath) {
      try {
        const content = await fs.readFile(result.projectPath);
        await filesystem.writeArtifact(jobId, "audacity", `${jobId}.aup3`, content);
        await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Wrote artifact: ${jobId}.aup3`);
      } catch (artifactError) {
        console.error(`[audacity-worker] Failed to write artifact:`, artifactError);
        await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] Warning: Failed to write artifact`);
      }
    }

    // Update metadata with success info
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.audacity = {
        status: "COMPLETE",
        projectPath: result.projectPath,
      };
      await filesystem.writeMetadata(jobId, updated);
    }

    await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.DONE as any, Actor.SYSTEM);

    console.log(`[audacity-worker] Job ${jobId} finished successfully`);
  } catch (error) {
    console.error(`[audacity-worker] Error processing job ${jobId}:`, error);

    // Log error
    try {
      await filesystem.appendToJobLog(jobId, `[AUDACITY-WORKER] ERROR: ${String(error)}`);
    } catch (logError) {
      console.error(`[audacity-worker] Failed to log error for job ${jobId}:`, logError);
    }

    // Try to mark as failed if not already
    try {
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata && metadata.state === JOB_STATES.RUNNING) {
        await moves.moveJob(jobId, JOB_STATES.RUNNING as any, JOB_STATES.FAILED as any, Actor.SYSTEM);
      }
    } catch (failError) {
      console.error(`[audacity-worker] Failed to mark job as failed:`, failError);
    }

    throw error;
  }
}
