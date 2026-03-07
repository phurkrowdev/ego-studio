/**
 * Artifact Cleanup Service
 *
 * Automatically deletes old ZIP artifacts (>14 days) to prevent long-term storage liability.
 * Runs as a cron job on server startup.
 */

import fs from "fs-extra";
import path from "path";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs";
const ARTIFACTS_DIR = path.join(STORAGE_ROOT, "artifacts");
const RETENTION_DAYS = 14;

export interface CleanupResult {
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
}

/**
 * Clean up old artifact files
 * @returns Cleanup result with statistics
 */
export async function cleanupOldArtifacts(): Promise<CleanupResult> {
  const result: CleanupResult = {
    filesDeleted: 0,
    bytesFreed: 0,
    errors: [],
  };

  try {
    // Ensure artifacts directory exists
    await fs.ensureDir(ARTIFACTS_DIR);

    // Get all files in artifacts directory
    const files = await fs.readdir(ARTIFACTS_DIR);

    const now = Date.now();
    const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(ARTIFACTS_DIR, file);

      try {
        const stat = await fs.stat(filePath);

        // Check if file is older than retention period
        const fileAge = now - stat.mtimeMs;
        if (fileAge > retentionMs) {
          const fileSize = stat.size;

          // Delete the file
          await fs.remove(filePath);

          result.filesDeleted++;
          result.bytesFreed += fileSize;

          console.log(
            `[ArtifactCleanup] Deleted ${file} (${(fileSize / 1024 / 1024).toFixed(2)}MB, age: ${Math.floor(fileAge / (24 * 60 * 60 * 1000))} days)`
          );
        }
      } catch (err) {
        const errorMsg = `Failed to process ${file}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(errorMsg);
        console.error(`[ArtifactCleanup] ${errorMsg}`);
      }
    }

    console.log(
      `[ArtifactCleanup] Cleanup complete: ${result.filesDeleted} files deleted, ${(result.bytesFreed / 1024 / 1024).toFixed(2)}MB freed`
    );
  } catch (err) {
    const errorMsg = `Cleanup failed: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(errorMsg);
    console.error(`[ArtifactCleanup] ${errorMsg}`);
  }

  return result;
}

/**
 * Schedule cleanup to run periodically
 * @param intervalMs - Interval in milliseconds (default: 24 hours)
 */
export function scheduleCleanup(intervalMs: number = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  console.log(
    `[ArtifactCleanup] Scheduling cleanup every ${Math.floor(intervalMs / (60 * 60 * 1000))} hours`
  );

  // Run cleanup immediately on startup
  cleanupOldArtifacts().catch((err) => {
    console.error("[ArtifactCleanup] Initial cleanup failed:", err);
  });

  // Schedule periodic cleanup
  return setInterval(() => {
    cleanupOldArtifacts().catch((err) => {
      console.error("[ArtifactCleanup] Scheduled cleanup failed:", err);
    });
  }, intervalMs);
}
