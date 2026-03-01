/**
 * File-Based Job Creation Service
 *
 * Extends JobsService to support file uploads instead of YouTube URLs.
 * Maintains backward compatibility with URL-based jobs.
 */

import path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import { filesystem } from "./filesystem";
import { FileMetadata, streamUploadToLocal, deleteUploadedFile } from "./file-upload";
import type { JobResponse } from "./jobs-service";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

/**
 * Create a new job from an uploaded file
 *
 * @param fileBuffer - File buffer from upload
 * @param filename - Original filename
 * @param mimeType - MIME type from upload
 * @returns Job response with file metadata
 */
export async function createJobFromFile(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<JobResponse> {
  // Upload file to local storage
  const { metadata: fileMetadata, localPath } = await streamUploadToLocal(
    fileBuffer,
    filename,
    mimeType,
    UPLOADS_DIR
  );

  try {
    // Create job folder with file metadata
    const { jobId, metadata } = await createJobFolderFromFile(fileMetadata);

    console.log(
      `[JobsService.createJobFromFile] Created job ${jobId} for file ${filename} (${fileBuffer.length} bytes)`
    );

    // Return job response
    return {
      jobId,
      state: metadata.state,
      metadata: {
        jobId: metadata.id || jobId,
        youtubeUrl: "", // Empty for file-based jobs
        state: metadata.state,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
    };
  } catch (err) {
    // Clean up uploaded file if job creation fails
    console.error(`[JobsService.createJobFromFile] Job creation failed, cleaning up file:`, err);
    await deleteUploadedFile(localPath);
    throw err;
  }
}

/**
 * Extend filesystem.createJobFolder to accept file metadata
 *
 * This is a temporary wrapper until filesystem is fully refactored.
 * For now, we store file metadata in the job metadata structure.
 */
export async function createJobFolderFromFile(
  fileMetadata: FileMetadata
): Promise<{ jobId: string; metadata: any }> {
  // For now, create job with file metadata instead of URL
  // This will be integrated into filesystem.createJobFolder in Phase 8.2

  const jobId = uuidv4();
  const now = new Date().toISOString();

  const jobDir = path.join(STORAGE_ROOT, "jobs", "NEW", jobId);
  await fs.ensureDir(jobDir);

  // Create logs directory and initial log file
  const logsDir = path.join(jobDir, "logs");
  await fs.ensureDir(logsDir);
  const logFile = path.join(logsDir, "job.log");
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Job created for file: ${fileMetadata.filename}\n`;
  await fs.writeFile(logFile, logEntry);

  const metadata = {
    id: jobId,
    file: fileMetadata, // Store file metadata instead of youtubeUrl
    youtubeUrl: "", // Empty for file-based jobs
    state: "NEW",
    createdAt: now,
    updatedAt: now,
  };

  await fs.writeJSON(path.join(jobDir, "metadata.json"), metadata, { spaces: 2 });

  return { jobId, metadata };
}
