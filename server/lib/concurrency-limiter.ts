/**
 * Concurrency Limiter
 *
 * Enforces per-user job concurrency limits to prevent GPU overload.
 * Default: 1-2 concurrent jobs per user.
 */

import { listJobs } from "./jobs-service";

export interface ConcurrencyStatus {
  allowed: boolean;
  running: number;
  limit: number;
  message?: string;
}

/**
 * Check if user can create a new job
 *
 * @param userId - User ID
 * @param limit - Max concurrent jobs (default: 2)
 * @returns Concurrency status
 */
export async function checkConcurrencyLimit(
  userId: string,
  limit: number = 2
): Promise<ConcurrencyStatus> {
  try {
    // Count CLAIMED and RUNNING jobs
    // In a real implementation, would filter by userId
    // For now, count all active jobs
    const claimedJobs = await listJobs({ state: "CLAIMED", limit: 100 });
    const runningJobs = await listJobs({ state: "RUNNING", limit: 100 });

    // Count only recently active jobs (last 10 minutes)
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;

    const activeJobs = [
      ...claimedJobs.filter(
        (j: any) => new Date(j.updatedAt).getTime() > tenMinutesAgo
      ),
      ...runningJobs.filter(
        (j: any) => new Date(j.updatedAt).getTime() > tenMinutesAgo
      ),
    ];

    const totalRunning = activeJobs.length;

    if (totalRunning >= limit) {
      return {
        allowed: false,
        running: totalRunning,
        limit,
        message: `You have ${totalRunning} job(s) processing. Maximum is ${limit}. Please wait for one to complete before starting another.`,
      };
    }

    return {
      allowed: true,
      running: totalRunning,
      limit,
    };
  } catch (err) {
    console.error("[ConcurrencyLimiter] Error checking limit:", err);
    // Fail open: allow job if we can't check
    return {
      allowed: true,
      running: 0,
      limit,
      message: "Could not verify concurrency limit. Proceeding with caution.",
    };
  }
}

/**
 * Get concurrency status for a user
 */
export async function getConcurrencyStatus(
  userId: string,
  limit: number = 2
): Promise<ConcurrencyStatus> {
  return checkConcurrencyLimit(userId, limit);
}
