/**
 * Job Worker
 *
 * Processes jobs from the demucs_queue:
 * 1. Poll for NEW jobs
 * 2. Transition: NEW → CLAIMED → RUNNING → DONE/FAILED
 * 3. Execute 4-stage pipeline
 * 4. Generate artifacts
 * 5. Create ZIP package
 */

import {
  createJob,
  listJobs,
  getJob,
  getJobLogs,
  simulateProgress,
  simulateFailure,
} from "./jobs-service";
import { filesystem } from "./filesystem";
import { createMoveOperations } from "./job-moves";
import { Actor } from "./job-state";
import path from "path";
import fs from "fs-extra";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const POLL_INTERVAL = 5000; // Poll every 5 seconds
const MAX_CONCURRENT_JOBS = 1; // Single GPU

let isRunning = false;
let activeJobs = 0;

/**
 * Start the job worker
 */
export function startJobWorker() {
  if (isRunning) {
    console.log("[JobWorker] Already running");
    return;
  }

  isRunning = true;
  console.log("[JobWorker] Started");
  pollForJobs();
}

/**
 * Stop the job worker
 */
export function stopJobWorker() {
  isRunning = false;
  console.log("[JobWorker] Stopped");
}

/**
 * Poll for NEW jobs and process them
 */
async function pollForJobs() {
  while (isRunning) {
    try {
      // Check if we can process more jobs
      if (activeJobs >= MAX_CONCURRENT_JOBS) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Get NEW jobs
      const jobs = await listJobs({ state: "NEW", limit: 1 });

      if (jobs.length === 0) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      const job = jobs[0];
      activeJobs++;

      // Process job in background (don't await)
      processJob(job.jobId).finally(() => {
        activeJobs--;
      });

      // Small delay before next poll
      await sleep(1000);
    } catch (err) {
      console.error("[JobWorker] Poll error:", err);
      await sleep(POLL_INTERVAL);
    }
  }
}

/**
 * Process a single job through the pipeline
 */
async function processJob(jobId: string) {
  try {
    console.log(`[JobWorker] Processing job ${jobId}`);

    // Transition to CLAIMED
    await simulateProgress(jobId);
    await appendLog(jobId, "[CLAIMED] Job claimed by worker");

    // Transition to RUNNING
    await simulateProgress(jobId);
    await appendLog(jobId, "[RUNNING] Starting pipeline execution");

    // Get job metadata
    const job = await getJob(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    // Get file metadata from job
    const fileMetadata = (job.metadata as any).file;
    if (!fileMetadata) {
      // Skip non-file-based jobs (e.g., YouTube URL jobs)
      await appendLog(jobId, "[SKIPPED] Job is not file-based (YouTube URL job)");
      console.log(`[JobWorker] Skipping non-file-based job ${jobId}`);
      return;
    }

    // Execute 4-stage pipeline
    await appendLog(jobId, "[STAGE 1/4] Ingesting audio file");
    const ingestResult = await executeIngest(jobId, fileMetadata);

    await appendLog(jobId, "[STAGE 2/4] Separating stems (Demucs)");
    const separationResult = await executeSeparation(jobId, ingestResult);

    await appendLog(jobId, "[STAGE 3/4] Extracting lyrics (Genius)");
    const lyricsResult = await executeLyrics(jobId, ingestResult);

    await appendLog(jobId, "[STAGE 4/4] Packaging artifacts");
    const packageResult = await executePackaging(jobId, {
      ingest: ingestResult,
      separation: separationResult,
      lyrics: lyricsResult,
    });

    // Update metadata with artifacts
    await updateJobMetadata(jobId, {
      download: { status: "DONE" },
      separation: { status: "DONE" },
      lyrics: { status: "DONE" },
      audacity: { status: "DONE" },
      artifacts: packageResult,
    });

    // Transition to DONE
    await simulateProgress(jobId);
    await appendLog(jobId, "[DONE] Pipeline execution completed successfully");

    console.log(`[JobWorker] Job ${jobId} completed`);
  } catch (err: any) {
    console.error(`[JobWorker] Job ${jobId} failed:`, err);
    await appendLog(jobId, `[ERROR] ${err.message}`);

    // Transition to FAILED
    try {
      await simulateFailure(jobId, "DOWNLOAD_ERROR");
      await updateJobMetadata(jobId, {
        failureReason: err.message,
      });
    } catch (updateErr) {
      console.error(`[JobWorker] Failed to update job state:`, updateErr);
    }
  }
}

/**
 * Stage 1: Ingest audio file
 */
async function executeIngest(
  jobId: string,
  fileMetadata: any
): Promise<{ title: string; artist: string; duration: number; filePath: string }> {
  try {
    // Extract metadata from filename (format: "Artist - Track.wav")
    const filename = fileMetadata.filename;
    const [artist, track] = filename.split(" - ").map((s: string) => s.trim());

    const title = track?.replace(/\.[^.]+$/, "") || "Untitled";
    const artistName = artist || "Unknown Artist";

    // Get file path from upload directory
    const filePath = path.join(STORAGE_ROOT, "uploads", fileMetadata.uploadedFilename);

    // In production, would use ffprobe to get actual duration
    const duration = 180; // 3 minutes placeholder

    await appendLog(
      jobId,
      `Ingested: ${artistName} - ${title} (${fileMetadata.size} bytes)`
    );

    return {
      title,
      artist: artistName,
      duration,
      filePath,
    };
  } catch (err: any) {
    throw new Error(`Ingest failed: ${err.message}`);
  }
}

/**
 * Stage 2: Separate stems (Demucs)
 */
async function executeSeparation(
  jobId: string,
  ingestResult: any
): Promise<{ stems: { name: string; path: string }[] }> {
  try {
    // In production, would call Demucs API or local model
    // For now, create mock stem files
    const jobDir = path.join(STORAGE_ROOT, "jobs", "NEW", jobId);
    const stemsDir = path.join(jobDir, "stems");
    await fs.ensureDir(stemsDir);

    const stemNames = ["vocals", "drums", "bass", "other"];
    const stems = [];

    // Create mock stem files
    for (const stemName of stemNames) {
      const stemPath = path.join(stemsDir, `${stemName}.wav`);
      // Create minimal WAV file (in production, would be actual separated audio)
      await fs.writeFile(stemPath, Buffer.alloc(44));
      stems.push({
        name: stemName,
        path: stemPath,
      });
    }

    await appendLog(jobId, `Separated into ${stems.length} stems`);

    return { stems };
  } catch (err: any) {
    throw new Error(`Separation failed: ${err.message}`);
  }
}

/**
 * Stage 3: Extract lyrics (Genius API)
 */
async function executeLyrics(
  jobId: string,
  ingestResult: any
): Promise<{ lyrics: string; source: string }> {
  try {
    // Import lyrics API
    const { getLyricsWithFallback } = await import("./lyrics-api");

    // Get lyrics from Genius API with fallback
    const result = await getLyricsWithFallback(ingestResult.title, ingestResult.artist);

    if (!result.success) {
      await appendLog(
        jobId,
        `Lyrics extraction failed: ${result.error} (using fallback)`
      );
    } else {
      await appendLog(
        jobId,
        `Extracted lyrics from ${result.source} (confidence: ${result.confidence})`
      );
    }

    return {
      lyrics: result.lyrics || "",
      source: result.source || "unknown",
    };
  } catch (err: any) {
    // Fallback to mock lyrics on error
    const mockLyrics = `[Verse 1]\nLyrics for: ${ingestResult.artist} - ${ingestResult.title}\n\n[Chorus]\nChorus lyrics...`;
    await appendLog(jobId, `Lyrics extraction error: ${err.message} (using mock)`);
    return {
      lyrics: mockLyrics,
      source: "mock",
    };
  }
}

/**
 * Stage 4: Package artifacts (ZIP)
 */
async function executePackaging(
  jobId: string,
  results: any
): Promise<{ zipPath: string; zipUrl: string }> {
  try {
    // Import ZIP creation utilities
    const archiver = await import("archiver");
    const { createAudacityProject } = await import("./audacity-project");

    const jobDir = path.join(STORAGE_ROOT, "jobs", "NEW", jobId);
    const stemsDir = path.join(jobDir, "stems");
    const artifactsDir = path.join(STORAGE_ROOT, "artifacts");
    await fs.ensureDir(artifactsDir);

    // Create package directory: Artist - Track/
    const packageName = `${results.ingest.artist} - ${results.ingest.title}`;
    const packageDir = path.join(jobDir, "package", packageName);
    await fs.ensureDir(packageDir);

    // Copy stems to package
    const packageStemsDir = path.join(packageDir, "stems");
    await fs.copy(stemsDir, packageStemsDir);

    // Write lyrics.txt
    const lyricsPath = path.join(packageDir, "lyrics.txt");
    await fs.writeFile(lyricsPath, results.lyrics.lyrics || "");

    // Create .aup3 project
    const stemFiles = {
      vocals: path.join(packageStemsDir, "vocals.wav"),
      drums: path.join(packageStemsDir, "drums.wav"),
      bass: path.join(packageStemsDir, "bass.wav"),
      other: path.join(packageStemsDir, "other.wav"),
    };

    const projectResult = await createAudacityProject(
      packageDir,
      `${results.ingest.artist} - ${results.ingest.title}`,
      stemFiles
    );

    if (!projectResult.success) {
      throw new Error(`Failed to create Audacity project: ${projectResult.error}`);
    }

    // Create ZIP archive
    const zipFilename = `${jobId}-artifacts.zip`;
    const zipPath = path.join(artifactsDir, zipFilename);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver.default("zip", { zlib: { level: 9 } });

    await new Promise<void>((resolve, reject) => {
      archive.on("error", reject);
      output.on("close", () => resolve());
      archive.pipe(output);
      archive.directory(packageDir, packageName);
      archive.finalize();
    });

    await appendLog(jobId, `Packaged artifacts into ZIP (${zipFilename})`);

    return {
      zipPath,
      zipUrl: `/api/artifacts/${zipFilename}`,
    };
  } catch (err: any) {
    throw new Error(`Packaging failed: ${err.message}`);
  }
}

/**
 * Append log entry to job log file
 */
async function appendLog(jobId: string, message: string) {
  try {
    const logsDir = path.join(STORAGE_ROOT, "jobs", "NEW", jobId, "logs");
    const logFile = path.join(logsDir, "job.log");
    
    // Ensure logs directory exists
    await fs.ensureDir(logsDir);
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    await fs.appendFile(logFile, logEntry);
  } catch (err) {
    console.error(`[JobWorker] Failed to append log for ${jobId}:`, err);
  }
}

/**
 * Update job metadata
 */
async function updateJobMetadata(jobId: string, updates: any) {
  try {
    const metadataFile = path.join(STORAGE_ROOT, "jobs", "NEW", jobId, "metadata.json");
    const metadata = await fs.readJSON(metadataFile);
    const updated = { ...metadata, ...updates, updatedAt: new Date().toISOString() };
    await fs.writeJSON(metadataFile, updated, { spaces: 2 });
  } catch (err) {
    console.error(`[JobWorker] Failed to update metadata for ${jobId}:`, err);
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
