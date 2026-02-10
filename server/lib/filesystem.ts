import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Filesystem Authority Layer
 *
 * Manages job state directories, metadata I/O, and artifacts.
 * State is encoded in directory location: NEW/, CLAIMED/, RUNNING/, DONE/, FAILED/
 *
 * Invariants:
 * - Job exists because folder exists, not vice versa
 * - State is directory name, never inferred
 * - Metadata is authoritative
 * - Logs are append-only
 * - Artifacts are immutable once written
 */

export const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";

export const JOB_STATES = {
  NEW: "NEW",
  CLAIMED: "CLAIMED",
  RUNNING: "RUNNING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;

export type JobState = (typeof JOB_STATES)[keyof typeof JOB_STATES];

/**
 * Job metadata schema
 */
export interface JobMetadata {
  id: string;
  youtubeUrl: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  leaseExpiresAt?: string;
  download?: {
    status: "COMPLETE" | "FAILED";
    reason?: "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR";
    message?: string;
    label?: string;
    error?: string;
    title?: string;
    artist?: string;
    duration?: number;
    fileFormat?: string;
    filePath?: string;
    fileSize?: number;
    downloadedAt?: string;
  };
  separation?: {
    status: "COMPLETE" | "FAILED" | "NOT_STARTED";
    model?: string;
    device?: "cuda" | "cpu";
    error?: string;
    finishedAt?: string;
  };
  lyrics?: {
    status: "COMPLETE" | "NOT_FOUND" | "FAILED";
    provider?: string;
    confidence?: number;
    error?: string;
  };
  audacity?: {
    status: "COMPLETE" | "FAILED";
    projectPath?: string;
    error?: string;
  };
}

/**
 * Initialize storage directories
 */
export async function initializeStorage(): Promise<void> {
  for (const state of Object.values(JOB_STATES)) {
    const dir = path.join(STORAGE_ROOT, "jobs", state);
    await fs.ensureDir(dir);
  }
}

/**
 * Create a new job folder in NEW state
 */
export async function createJobFolder(youtubeUrl: string): Promise<{ jobId: string; metadata: JobMetadata }> {
  const jobId = uuidv4();
  const now = new Date().toISOString();

  const jobDir = path.join(STORAGE_ROOT, "jobs", JOB_STATES.NEW, jobId);
  await fs.ensureDir(jobDir);

  // Create logs directory
  await fs.ensureDir(path.join(jobDir, "logs"));

  const metadata: JobMetadata = {
    id: jobId,
    youtubeUrl,
    state: JOB_STATES.NEW,
    createdAt: now,
    updatedAt: now,
  };

  await fs.writeJSON(path.join(jobDir, "metadata.json"), metadata, { spaces: 2 });

  // Log creation
  await appendToJobLog(jobId, `Job created for URL: ${youtubeUrl}`);

  return { jobId, metadata };
}

/**
 * Read job metadata from filesystem
 */
export async function readMetadata(jobId: string): Promise<JobMetadata | null> {
  // Search for job in all state directories
  for (const state of Object.values(JOB_STATES)) {
    const metadataPath = path.join(STORAGE_ROOT, "jobs", state, jobId, "metadata.json");
    if (await fs.pathExists(metadataPath)) {
      return fs.readJSON(metadataPath);
    }
  }
  return null;
}

/**
 * Write job metadata to filesystem
 */
export async function writeMetadata(jobId: string, metadata: JobMetadata): Promise<void> {
  const state = metadata.state;
  const metadataPath = path.join(STORAGE_ROOT, "jobs", state, jobId, "metadata.json");

  // Ensure directory exists
  await fs.ensureDir(path.dirname(metadataPath));

  // Update timestamp
  metadata.updatedAt = new Date().toISOString();

  await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
}

/**
 * Get the current state directory for a job
 */
export async function getJobStateDir(jobId: string): Promise<{ state: JobState; dir: string } | null> {
  for (const state of Object.values(JOB_STATES)) {
    const dir = path.join(STORAGE_ROOT, "jobs", state, jobId);
    if (await fs.pathExists(dir)) {
      return { state, dir };
    }
  }
  return null;
}

/**
 * List all jobs in a given state
 */
export async function listJobsByState(state: JobState): Promise<string[]> {
  const stateDir = path.join(STORAGE_ROOT, "jobs", state);
  if (!(await fs.pathExists(stateDir))) {
    return [];
  }

  const entries = await fs.readdir(stateDir);
  return entries.filter((entry: string) => fs.statSync(path.join(stateDir, entry)).isDirectory());
}

/**
 * List all jobs across all states
 */
export async function listAllJobs(): Promise<{ jobId: string; state: JobState; metadata: JobMetadata }[]> {
  const jobs: { jobId: string; state: JobState; metadata: JobMetadata }[] = [];

  for (const state of Object.values(JOB_STATES)) {
    const jobIds = await listJobsByState(state);
    for (const jobId of jobIds) {
      const metadata = await readMetadata(jobId);
      if (metadata) {
        jobs.push({ jobId, state, metadata });
      }
    }
  }

  // Sort by createdAt descending
  jobs.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());

  return jobs;
}

/**
 * Append to job log (append-only)
 */
export async function appendToJobLog(jobId: string, message: string): Promise<void> {
  const stateDir = await getJobStateDir(jobId);
  if (!stateDir) {
    throw new Error(`Job ${jobId} not found`);
  }

  const logFile = path.join(stateDir.dir, "logs", "job.log");
  await fs.ensureDir(path.dirname(logFile));

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  await fs.appendFile(logFile, logEntry);
}

/**
 * Read job logs
 */
export async function readJobLogs(jobId: string): Promise<string[]> {
  const stateDir = await getJobStateDir(jobId);
  if (!stateDir) {
    throw new Error(`Job ${jobId} not found`);
  }

  const logFile = path.join(stateDir.dir, "logs", "job.log");
  if (!(await fs.pathExists(logFile))) {
    return [];
  }

  const content = await fs.readFile(logFile, "utf-8");
  return content.split("\n").filter((line: string) => line.trim());
}

/**
 * List artifacts for a job
 */
export async function listArtifacts(jobId: string): Promise<Record<string, string[]>> {
  const stateDir = await getJobStateDir(jobId);
  if (!stateDir) {
    throw new Error(`Job ${jobId} not found`);
  }

  const artifacts: Record<string, string[]> = {};

  // Check for artifact directories
  const artifactDirs = ["download", "separation", "lyrics", "audacity"];
  for (const dir of artifactDirs) {
    const artifactPath = path.join(stateDir.dir, dir);
    if (await fs.pathExists(artifactPath)) {
      const files = await fs.readdir(artifactPath);
      artifacts[dir] = files;
    }
  }

  return artifacts;
}

/**
 * Get artifact file path
 */
export async function getArtifactPath(jobId: string, artifactType: string, fileName: string): Promise<string | null> {
  const stateDir = await getJobStateDir(jobId);
  if (!stateDir) {
    return null;
  }

  const filePath = path.join(stateDir.dir, artifactType, fileName);
  if (await fs.pathExists(filePath)) {
    return filePath;
  }

  return null;
}

/**
 * Write artifact file
 */
export async function writeArtifact(jobId: string, artifactType: string, fileName: string, data: Buffer | string): Promise<string> {
  const stateDir = await getJobStateDir(jobId);
  if (!stateDir) {
    throw new Error(`Job ${jobId} not found`);
  }

  const artifactDir = path.join(stateDir.dir, artifactType);
  await fs.ensureDir(artifactDir);

  const filePath = path.join(artifactDir, fileName);
  if (typeof data === "string") {
    await fs.writeFile(filePath, data);
  } else {
    await fs.writeFile(filePath, data);
  }

  return filePath;
}

/**
 * Delete a job folder (used for cleanup, not normal operation)
 */
export async function deleteJobFolder(jobId: string): Promise<void> {
  const stateDir = await getJobStateDir(jobId);
  if (stateDir) {
    await fs.remove(stateDir.dir);
  }
}
