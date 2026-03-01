/**
 * JobsService — Thin wrapper around Phase 0 infrastructure
 *
 * Responsibilities:
 * - Convert filesystem state to tRPC response shapes
 * - Orchestrate state transitions via state machine
 * - Provide high-level operations (create, list, get, logs, artifacts)
 * - Maintain API contract with UI (no shape changes)
 *
 * Architecture:
 * - Filesystem is authority (single source of truth)
 * - State machine validates all transitions
 * - Atomic moves guarantee consistency
 * - No in-memory state
 */

import { filesystem } from "./filesystem";
import { createMoveOperations } from "./job-moves";
import { Actor, validateTransition } from "./job-state";
import { JOB_STATES } from "./filesystem";
import path from "path";

// Get storage root from environment
const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";

// Create move operations with production filesystem
const moves = createMoveOperations(filesystem, STORAGE_ROOT);

/**
 * Job response shape (matches tRPC contract)
 */
export interface JobResponse {
  jobId: string;
  state: "NEW" | "CLAIMED" | "RUNNING" | "DONE" | "FAILED";
  metadata: {
    jobId: string;
    youtubeUrl: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    title?: string;
    artist?: string;
    download?: {
      status: string;
      reason?: string;
      message?: string;
      label?: string;
    };
    separation?: {
      status: string;
    };
    lyrics?: {
      status: string;
    };
    audacity?: {
      status: string;
    };
    file?: {
      filename: string;
      uploadedFilename: string;
      size: number;
      mimeType: string;
      uploadedAt: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create a new job from YouTube URL
 */
export async function createJob(youtubeUrl: string): Promise<JobResponse> {
  const { jobId, metadata } = await filesystem.createJobFolder(youtubeUrl);

  console.log(`[JobsService.createJob] Created job ${jobId} for ${youtubeUrl}`);

  return jobToResponse(jobId, metadata);
}

/**
 * List all jobs with optional filtering
 */
export async function listJobs(options: {
  limit?: number;
  offset?: number;
  state?: string;
}): Promise<JobResponse[]> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  // Get all jobs from filesystem
  const allJobs = await filesystem.listAllJobs();

  // Filter by state if provided
  let filtered = allJobs;
  if (options.state) {
    filtered = allJobs.filter((j) => j.metadata.state === options.state);
  }

  // Sort by createdAt descending
  filtered.sort(
    (a, b) =>
      new Date(b.metadata.createdAt).getTime() -
      new Date(a.metadata.createdAt).getTime()
  );

  // Paginate
  const paginated = filtered.slice(offset, offset + limit);

  console.log(
    `[JobsService.listJobs] Returning ${paginated.length} jobs (total: ${filtered.length})`
  );

  return paginated.map((j) => jobToResponse(j.jobId, j.metadata));
}

/**
 * Get a single job by ID
 */
export async function getJob(jobId: string): Promise<JobResponse> {
  const metadata = await filesystem.readMetadata(jobId);

  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  console.log(`[JobsService.getJob] Retrieved job ${jobId}`);

  return jobToResponse(jobId, metadata);
}

/**
 * Get logs for a job
 */
export async function getJobLogs(jobId: string): Promise<{
  jobId: string;
  logs: string[];
}> {
  // Verify job exists
  const metadata = await filesystem.readMetadata(jobId);
  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Read logs
  const logs = await filesystem.readJobLogs(jobId);

  console.log(`[JobsService.getJobLogs] Retrieved logs for job ${jobId}`);

  return {
    jobId,
    logs,
  };
}

/**
 * Get artifacts for a job
 */
export async function getJobArtifacts(jobId: string): Promise<{
  jobId: string;
  download?: any;
  separation?: any;
  lyrics?: any;
  audacity?: any;
}> {
  // Verify job exists
  const metadata = await filesystem.readMetadata(jobId);
  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  console.log(`[JobsService.getJobArtifacts] Retrieved artifacts for job ${jobId}`);

  return {
    jobId,
    download: metadata.download,
    separation: metadata.separation,
    lyrics: metadata.lyrics,
    audacity: metadata.audacity,
  };
}

/**
 * Simulate progress (state transition)
 * Transitions: NEW → CLAIMED → RUNNING → DONE
 */
export async function simulateProgress(jobId: string): Promise<JobResponse> {
  const metadata = await filesystem.readMetadata(jobId);

  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Define valid transitions with appropriate actors
  const transitions: Record<string, { nextState: string; actor: Actor }> = {
    NEW: { nextState: JOB_STATES.CLAIMED, actor: Actor.SYSTEM },
    CLAIMED: { nextState: JOB_STATES.RUNNING, actor: Actor.DOWNLOAD_WORKER },
    RUNNING: { nextState: JOB_STATES.DONE, actor: Actor.DOWNLOAD_WORKER },
  };

  const transition = transitions[metadata.state];

  if (!transition) {
    console.log(
      `[JobsService.simulateProgress] Job ${jobId} already in terminal state ${metadata.state}`
    );
    return jobToResponse(jobId, metadata);
  }

  const { nextState, actor } = transition;

  // Perform state transition via state machine
  await moves.moveJob(jobId, metadata.state as any, nextState as any, actor);

  // If transitioning to DONE, populate artifacts
  if (nextState === JOB_STATES.DONE) {
    const updated = await filesystem.readMetadata(jobId);
    if (updated) {
      updated.download = { status: "COMPLETE", title: "Example Song", artist: "Example Artist" };
      updated.separation = { status: "COMPLETE" };
      await filesystem.writeMetadata(jobId, updated);
    }
  }

  // Read updated metadata
  const updatedMetadata = await filesystem.readMetadata(jobId);
  if (!updatedMetadata) {
    throw new Error(`Failed to read updated metadata for job ${jobId}`);
  }

  console.log(
    `[JobsService.simulateProgress] Transitioned job ${jobId} to ${nextState}`
  );

  return jobToResponse(jobId, updatedMetadata);
}

/**
 * Simulate failure (state transition to FAILED)
 */
export async function simulateFailure(
  jobId: string,
  reason: "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR"
): Promise<JobResponse> {
  const metadata = await filesystem.readMetadata(jobId);

  if (!metadata) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Transition to FAILED state
  // Note: State machine allows CLAIMED/RUNNING → FAILED
  const currentState = metadata.state;

  if (currentState === JOB_STATES.NEW || currentState === JOB_STATES.DONE) {
    throw new Error(`Cannot fail job in state ${currentState}`);
  }

  // Move to FAILED
  if (currentState !== JOB_STATES.FAILED) {
    await moves.moveJob(jobId, currentState as any, JOB_STATES.FAILED as any, Actor.DOWNLOAD_WORKER);
  }

  // Update metadata with failure reason
  const updated = await filesystem.readMetadata(jobId);
  if (updated) {
    updated.download = {
      status: "FAILED",
      reason,
      message: `Download failed: ${reason}`,
    };
    await filesystem.writeMetadata(jobId, updated);
  }

  // Read final metadata
  const finalMetadata = await filesystem.readMetadata(jobId);
  if (!finalMetadata) {
    throw new Error(`Failed to read final metadata for job ${jobId}`);
  }

  console.log(
    `[JobsService.simulateFailure] Job ${jobId} failed with reason ${reason}`
  );

  return jobToResponse(jobId, finalMetadata);
}

/**
 * Health check
 */
export async function health(): Promise<{
  status: string;
  timestamp: Date;
  jobsCount: number;
}> {
  const allJobs = await filesystem.listAllJobs();

  console.log("[JobsService.health] Health check");

  return {
    status: "ok",
    timestamp: new Date(),
    jobsCount: allJobs.length,
  };
}

/**
 * Convert filesystem metadata to tRPC response shape
 */
function jobToResponse(jobId: string, metadata: any): JobResponse {
  return {
    jobId,
    state: metadata.state,
    metadata: {
      jobId: metadata.id || jobId,
      youtubeUrl: metadata.youtubeUrl,
      state: metadata.state,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      title: metadata.title,
      artist: metadata.artist,
      download: metadata.download,
      separation: metadata.separation,
      lyrics: metadata.lyrics,
      audacity: metadata.audacity,
      file: metadata.file,
    },
    createdAt: new Date(metadata.createdAt),
    updatedAt: new Date(metadata.updatedAt),
  };
}
