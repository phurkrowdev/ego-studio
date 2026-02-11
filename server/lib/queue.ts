/**
 * Bull Queue Management
 *
 * Initializes and manages job queues.
 * Connects to Redis (or in-memory for testing).
 */

import Queue from "bull";
import { processYtDlpJob, YT_DLP_QUEUE_NAME, JOB_OPTIONS } from "../workers/yt-dlp-worker";
import { processDemucsJob, DEMUCS_QUEUE_NAME } from "../workers/demucs-worker";

let ytDlpQueue: Queue.Queue<{ jobId: string }> | null = null;
let demucsQueue: Queue.Queue<{ jobId: string }> | null = null;

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
    ytDlpQueue.on("completed", async (job) => {
      console.log(`[queue] yt-dlp job ${job.data.jobId} completed, enqueueing for Demucs`);
      // Automatically enqueue for Demucs after yt-dlp completes
      try {
        await enqueueDemucsJob(job.data.jobId);
      } catch (err) {
        console.error(`[queue] Failed to enqueue Demucs job:`, err);
      }
    });

    ytDlpQueue.on("failed", (job, err) => {
      console.error(`[queue] yt-dlp job ${job.data.jobId} failed:`, err.message);
    });

    ytDlpQueue.on("error", (err) => {
      console.error(`[queue] yt-dlp queue error:`, err);
    });

    // Initialize Demucs queue
    demucsQueue = new Queue(DEMUCS_QUEUE_NAME, {
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

    // Register Demucs processor
    demucsQueue.process(1, processDemucsJob);

    // Event handlers
    demucsQueue.on("completed", (job) => {
      console.log(`[queue] Demucs job ${job.data.jobId} completed`);
    });

    demucsQueue.on("failed", (job, err) => {
      console.error(`[queue] Demucs job ${job.data.jobId} failed:`, err.message);
    });

    demucsQueue.on("error", (err) => {
      console.error(`[queue] Demucs queue error:`, err);
    });

    console.log(`[queue] All queues initialized successfully`);
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
 * Get Demucs queue
 */
export function getDemucsQueue(): Queue.Queue<{ jobId: string }> {
  if (!demucsQueue) {
    throw new Error("Queues not initialized. Call initializeQueues() first.");
  }
  return demucsQueue;
}

/**
 * Add a job to the yt-dlp queue
 */
export async function enqueueYtDlpJob(jobId: string): Promise<Queue.Job<{ jobId: string }>> {
  const queue = getYtDlpQueue();
  const job = await queue.add({ jobId }, JOB_OPTIONS);
  console.log(`[queue] Enqueued yt-dlp job ${jobId} (Bull job ID: ${job.id})`);
  return job;
}

/**
 * Add a job to the Demucs queue
 */
export async function enqueueDemucsJob(jobId: string): Promise<Queue.Job<{ jobId: string }>> {
  const queue = getDemucsQueue();
  const job = await queue.add({ jobId }, JOB_OPTIONS);
  console.log(`[queue] Enqueued Demucs job ${jobId} (Bull job ID: ${job.id})`);
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
  if (demucsQueue) {
    await demucsQueue.close();
    demucsQueue = null;
  }
  console.log(`[queue] All queues closed`);
}

/**
 * Get queue stats
 */
export async function getQueueStats(): Promise<{
  ytDlp: { active: number; waiting: number; completed: number; failed: number; delayed: number };
  demucs: { active: number; waiting: number; completed: number; failed: number; delayed: number };
}> {
  const ytDlpQueueRef = getYtDlpQueue();
  const demucsQueueRef = getDemucsQueue();

  const [ytDlpActive, ytDlpWaiting, ytDlpCompleted, ytDlpFailed, ytDlpDelayed] = await Promise.all([
    ytDlpQueueRef.getActiveCount(),
    ytDlpQueueRef.getWaitingCount(),
    ytDlpQueueRef.getCompletedCount(),
    ytDlpQueueRef.getFailedCount(),
    ytDlpQueueRef.getDelayedCount(),
  ]);

  const [demucsActive, demucsWaiting, demucsCompleted, demucsFailed, demucsDelayed] = await Promise.all([
    demucsQueueRef.getActiveCount(),
    demucsQueueRef.getWaitingCount(),
    demucsQueueRef.getCompletedCount(),
    demucsQueueRef.getFailedCount(),
    demucsQueueRef.getDelayedCount(),
  ]);

  return {
    ytDlp: { active: ytDlpActive, waiting: ytDlpWaiting, completed: ytDlpCompleted, failed: ytDlpFailed, delayed: ytDlpDelayed },
    demucs: { active: demucsActive, waiting: demucsWaiting, completed: demucsCompleted, failed: demucsFailed, delayed: demucsDelayed },
  };
}
