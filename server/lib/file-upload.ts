/**
 * File Upload Infrastructure
 *
 * Handles audio file uploads with validation, streaming, and local storage.
 * Supports WAV, MP3, AIFF, FLAC with 200MB size limit.
 *
 * No resumable uploads in this sprint.
 * Local storage first; S3 deferred to Phase 8.7.
 */

import fs from "fs-extra";
import path from "path";
import { nanoid } from "nanoid";

/**
 * Supported audio formats and their MIME types
 */
export const SUPPORTED_FORMATS = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  aiff: "audio/aiff",
} as const;

export type AudioFormat = keyof typeof SUPPORTED_FORMATS;

/**
 * File upload constraints
 */
export const UPLOAD_CONSTRAINTS = {
  maxFileSize: 200 * 1024 * 1024, // 200MB
  supportedMimeTypes: Object.values(SUPPORTED_FORMATS),
} as const;

/**
 * File metadata after upload
 */
export interface FileMetadata {
  filename: string;
  size: number;
  format: AudioFormat;
  mimeType: string;
  uploadedAt: string;
  s3Key: null; // Placeholder for S3 integration in Phase 8.7
}

/**
 * File upload error types
 */
export class FileUploadError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "FileUploadError";
  }
}

/**
 * Validate file MIME type
 */
export function validateMimeType(mimeType: string): AudioFormat {
  const format = Object.entries(SUPPORTED_FORMATS).find(
    ([_, mime]) => mime === mimeType
  )?.[0];

  if (!format) {
    throw new FileUploadError(
      "INVALID_FILE_FORMAT",
      `Unsupported file format. Supported formats: WAV, MP3, AIFF, FLAC`
    );
  }

  return format as AudioFormat;
}

/**
 * Validate file size
 */
export function validateFileSize(size: number): void {
  if (size > UPLOAD_CONSTRAINTS.maxFileSize) {
    throw new FileUploadError(
      "FILE_TOO_LARGE",
      `File is too large. Maximum size is 200MB.`
    );
  }

  if (size <= 0) {
    throw new FileUploadError(
      "FILE_UPLOAD_ERROR",
      `File is empty. Please upload a valid audio file.`
    );
  }
}

/**
 * Sanitize filename for storage
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and special characters
  return filename
    .replace(/[\/\\]/g, "") // Remove slashes
    .replace(/\.+/g, ".") // Collapse multiple dots
    .replace(/[^\w\s.-]/g, "") // Remove special chars
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/^\.*/, "") // Remove leading dots
    .substring(0, 255);
}

/**
 * Extract file format from filename
 */
export function getFormatFromFilename(filename: string): AudioFormat {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (ext in SUPPORTED_FORMATS) {
    return ext as AudioFormat;
  }
  throw new FileUploadError(
    "INVALID_FILE_FORMAT",
    `Unsupported file format. Supported formats: WAV, MP3, AIFF, FLAC`
  );
}

/**
 * Stream file upload to local storage
 *
 * @param fileBuffer - File buffer from upload
 * @param filename - Original filename
 * @param mimeType - MIME type from upload
 * @param uploadDir - Directory to store uploads
 * @returns File metadata and local path
 */
export async function streamUploadToLocal(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  uploadDir: string
): Promise<{ metadata: FileMetadata; localPath: string }> {
  // Validate MIME type
  const format = validateMimeType(mimeType);

  // Validate file size
  validateFileSize(fileBuffer.length);

  // Sanitize filename
  const sanitized = sanitizeFilename(filename);

  // Generate unique filename to avoid collisions
  const uniqueId = nanoid(8);
  const storedFilename = `${uniqueId}-${sanitized}`;
  const localPath = path.join(uploadDir, storedFilename);

  // Ensure upload directory exists
  await fs.ensureDir(uploadDir);

  // Write file to disk
  await fs.writeFile(localPath, fileBuffer);

  // Verify file was written
  const stats = await fs.stat(localPath);
  if (stats.size !== fileBuffer.length) {
    await fs.remove(localPath);
    throw new FileUploadError(
      "FILE_UPLOAD_ERROR",
      `Failed to save file. Please try again.`
    );
  }

  const metadata: FileMetadata = {
    filename: sanitized,
    size: fileBuffer.length,
    format,
    mimeType,
    uploadedAt: new Date().toISOString(),
    s3Key: null,
  };

  console.log(
    `[FileUpload] Saved ${sanitized} (${fileBuffer.length} bytes) to ${localPath}`
  );

  return { metadata, localPath };
}

/**
 * Delete uploaded file
 */
export async function deleteUploadedFile(localPath: string): Promise<void> {
  try {
    await fs.remove(localPath);
    console.log(`[FileUpload] Deleted ${localPath}`);
  } catch (err) {
    console.error(`[FileUpload] Failed to delete ${localPath}:`, err);
  }
}

/**
 * Get file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
