/**
 * Bull Queue Management
 *
 * Initializes and manages job queues.
 * Connects to Redis (or in-memory for testing).
 */

import Queue from "bull";
import { processYtDlpJob, YT_DLP_QUEUE_NAME, JOB_OPTIONS } from "../workers/yt-dlp-worker";
import { processDemucsJob, DEMUCS_QUEUE_NAME } from "../workers/demucs-worker";
import { processLyricsJob, LYRICS_QUEUE_NAME } from "../workers/lyrics-worker";
import { processAudacityJob, AUDACITY_QUEUE_NAME } from "../workers/audacity-worker";

let ytDlpQueue: Queue.Queue<{ jobId: string }> | null = null;
let demucsQueue: Queue.Queue<{ jobId: string }> | null = null;
let lyricsQueue: Queue.Queue<{ jobId: string }> | null = null;
let audacityQueue: Queue.Queue<{ jobId: string }> | null = null;

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
    demucsQueue.on("completed", async (job) => {
      console.log(`[queue] Demucs job ${job.data.jobId} completed, enqueueing for Lyrics`);
      try {
        await enqueueLyricsJob(job.data.jobId);
      } catch (err) {
        console.error(`[queue] Failed to enqueue Lyrics job:`, err);
      }
    });

    demucsQueue.on("failed", (job, err) => {
      console.error(`[queue] Demucs job ${job.data.jobId} failed:`, err.message);
    });

    demucsQueue.on("error", (err) => {
      console.error(`[queue] Demucs queue error:`, err);
    });

    // Initialize Lyrics queue
    lyricsQueue = new Queue(LYRICS_QUEUE_NAME, {
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

    // Register Lyrics processor
    lyricsQueue.process(1, processLyricsJob);

    // Event handlers
    lyricsQueue.on("completed", async (job) => {
      console.log(`[queue] Lyrics job ${job.data.jobId} completed, enqueueing for Audacity`);
      try {
        await enqueueAudacityJob(job.data.jobId);
      } catch (err) {
        console.error(`[queue] Failed to enqueue Audacity job:`, err);
      }
    });

    lyricsQueue.on("failed", (job, err) => {
      console.error(`[queue] Lyrics job ${job.data.jobId} failed:`, err.message);
    });

    lyricsQueue.on("error", (err) => {
      console.error(`[queue] Lyrics queue error:`, err);
    });

    // Initialize Audacity queue
    audacityQueue = new Queue(AUDACITY_QUEUE_NAME, {
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

    // Register Audacity processor
    audacityQueue.process(1, processAudacityJob);

    // Event handlers
    audacityQueue.on("completed", (job) => {
      console.log(`[queue] Audacity job ${job.data.jobId} completed (final stage)`);
    });

    audacityQueue.on("failed", (job, err) => {
      console.error(`[queue] Audacity job ${job.data.jobId} failed:`, err.message);
    });

    audacityQueue.on("error", (err) => {
      console.error(`[queue] Audacity queue error:`, err);
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
 * Get Lyrics queue
 */
export function getLyricsQueue(): Queue.Queue<{ jobId: string }> {
  if (!lyricsQueue) {
    throw new Error("Queues not initialized. Call initializeQueues() first.");
  }
  return lyricsQueue;
}

/**
 * Get Audacity queue
 */
export function getAudacityQueue(): Queue.Queue<{ jobId: string }> {
  if (!audacityQueue) {
    throw new Error("Queues not initialized. Call initializeQueues() first.");
  }
  return audacityQueue;
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
 * Add a job to the Lyrics queue
 */
export async function enqueueLyricsJob(jobId: string): Promise<Queue.Job<{ jobId: string }>> {
  const queue = getLyricsQueue();
  const job = await queue.add({ jobId }, JOB_OPTIONS);
  console.log(`[queue] Enqueued Lyrics job ${jobId} (Bull job ID: ${job.id})`);
  return job;
}

/**
 * Add a job to the Audacity queue
 */
export async function enqueueAudacityJob(jobId: string): Promise<Queue.Job<{ jobId: string }>> {
  const queue = getAudacityQueue();
  const job = await queue.add({ jobId }, JOB_OPTIONS);
  console.log(`[queue] Enqueued Audacity job ${jobId} (Bull job ID: ${job.id})`);
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
  if (lyricsQueue) {
    await lyricsQueue.close();
    lyricsQueue = null;
  }
  if (audacityQueue) {
    await audacityQueue.close();
    audacityQueue = null;
  }
  console.log(`[queue] All queues closed`);
}

/**
 * Get queue stats
 */
export async function getQueueStats(): Promise<{
  ytDlp: { active: number; waiting: number; completed: number; failed: number };
  demucs: { active: number; waiting: number; completed: number; failed: number };
  lyrics: { active: number; waiting: number; completed: number; failed: number };
  audacity: { active: number; waiting: number; completed: number; failed: number };
}> {
  return {
    ytDlp: {
      active: await getYtDlpQueue().getActiveCount(),
      waiting: await getYtDlpQueue().getWaitingCount(),
      completed: await getYtDlpQueue().getCompletedCount(),
      failed: await getYtDlpQueue().getFailedCount(),
    },
    demucs: {
      active: await getDemucsQueue().getActiveCount(),
      waiting: await getDemucsQueue().getWaitingCount(),
      completed: await getDemucsQueue().getCompletedCount(),
      failed: await getDemucsQueue().getFailedCount(),
    },
    lyrics: {
      active: await getLyricsQueue().getActiveCount(),
      waiting: await getLyricsQueue().getWaitingCount(),
      completed: await getLyricsQueue().getCompletedCount(),
      failed: await getLyricsQueue().getFailedCount(),
    },
    audacity: {
      active: await getAudacityQueue().getActiveCount(),
      waiting: await getAudacityQueue().getWaitingCount(),
      completed: await getAudacityQueue().getCompletedCount(),
      failed: await getAudacityQueue().getFailedCount(),
    },
  };
}
