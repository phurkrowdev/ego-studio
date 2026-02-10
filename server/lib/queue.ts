/**
 * Bull Queue Management
 *
 * Initializes and manages job queues.
 * Connects to Redis (or in-memory for testing).
 */

import Queue from "bull";
import { processYtDlpJob, YT_DLP_QUEUE_NAME, JOB_OPTIONS } from "../workers/yt-dlp-worker";

let ytDlpQueue: Queue.Queue<{ jobId: string }> | null = null;

/**
 * Initialize queues
 */
export async function initializeQueues(): Promise<void> {
  try {
    // Initialize yt-dlp queue
    ytDlpQueue = new Queue(YT_DLP_QUEUE_NAME, {
      redis: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: parseInt(process.env.REDIS_PORT || "6379"),
      },
      settings: {
        lockDuration: 30000,
        lockRenewTime: 15000,
        maxStalledCount: 2,
        stalledInterval: 5000,
      },
    });

    // Register job processor
    ytDlpQueue.process(1, processYtDlpJob);

    // Event handlers
    ytDlpQueue.on("completed", (job) => {
      console.log(`[queue] Job ${job.data.jobId} completed`);
    });

    ytDlpQueue.on("failed", (job, err) => {
      console.error(`[queue] Job ${job.data.jobId} failed:`, err.message);
    });

    ytDlpQueue.on("error", (err) => {
      console.error(`[queue] Queue error:`, err);
    });

    console.log(`[queue] Queues initialized successfully`);
  } catch (error) {
    console.error(`[queue] Failed to initialize queues:`, error);
    throw error;
  }
}

/**
 * Get yt-dlp queue
 */
export function getYtDlpQueue(): Queue.Queue<{ jobId: string }> {
  if (!ytDlpQueue) {
    throw new Error("Queues not initialized. Call initializeQueues() first.");
  }
  return ytDlpQueue;
}

/**
 * Add a job to the yt-dlp queue
 */
export async function enqueueYtDlpJob(jobId: string): Promise<Queue.Job<{ jobId: string }>> {
  const queue = getYtDlpQueue();
  const job = await queue.add({ jobId }, JOB_OPTIONS);
  console.log(`[queue] Enqueued job ${jobId} (Bull job ID: ${job.id})`);
  return job;
}

/**
 * Close all queues
 */
export async function closeQueues(): Promise<void> {
  if (ytDlpQueue) {
    await ytDlpQueue.close();
    ytDlpQueue = null;
  }
  console.log(`[queue] Queues closed`);
}

/**
 * Get queue stats
 */
export async function getQueueStats(): Promise<{
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getYtDlpQueue();
  const [active, waiting, completed, failed, delayed] = await Promise.all([
    queue.getActiveCount(),
    queue.getWaitingCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { active, waiting, completed, failed, delayed };
}
