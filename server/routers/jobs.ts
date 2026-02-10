import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { v4 as uuidv4 } from "uuid";

/**
 * In-memory job storage (stub for demonstration)
 * In production, this will read from filesystem + database
 */
const inMemoryJobs: Record<
  string,
  {
    jobId: string;
    state: "NEW" | "CLAIMED" | "RUNNING" | "DONE" | "FAILED";
    youtube_url: string;
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
    created_at: string;
    updated_at: string;
  }
> = {};

export const jobsRouter = router({
  /**
   * Create a new job from a YouTube URL
   */
  create: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const jobId = uuidv4();
      const now = new Date().toISOString();

      const job = {
        jobId,
        state: "NEW" as const,
        youtube_url: input.url,
        title: undefined,
        artist: undefined,
        created_at: now,
        updated_at: now,
      };

      inMemoryJobs[jobId] = job;

      console.log(`[jobs.create] Created job ${jobId} for ${input.url}`);

      return {
        jobId,
        metadata: job,
      };
    }),

  /**
   * List all jobs with optional filtering
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        state: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let jobs = Object.values(inMemoryJobs);

      if (input.state) {
        jobs = jobs.filter((j) => j.state === input.state);
      }

      // Sort by created_at descending
      jobs.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const paginated = jobs.slice(input.offset, input.offset + input.limit);

      console.log(
        `[jobs.list] Returning ${paginated.length} jobs (total: ${jobs.length})`
      );

      return paginated.map((job) => ({
        jobId: job.jobId,
        state: job.state,
        metadata: job,
        createdAt: new Date(job.created_at),
        updatedAt: new Date(job.updated_at),
      }));
    }),

  /**
   * Get a single job by ID
   */
  get: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = inMemoryJobs[input.jobId];

      if (!job) {
        throw new Error(`Job ${input.jobId} not found`);
      }

      console.log(`[jobs.get] Retrieved job ${input.jobId}`);

      return {
        jobId: job.jobId,
        state: job.state,
        metadata: job,
        createdAt: new Date(job.created_at),
        updatedAt: new Date(job.updated_at),
      };
    }),

  /**
   * Get logs for a job
   */
  logs: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = inMemoryJobs[input.jobId];

      if (!job) {
        throw new Error(`Job ${input.jobId} not found`);
      }

      console.log(`[jobs.logs] Retrieved logs for job ${input.jobId}`);

      return {
        jobId: input.jobId,
        logs: [
          `[${job.created_at}] Job created`,
          `[${new Date().toISOString()}] Job in state ${job.state}`,
        ],
      };
    }),

  /**
   * Get artifacts for a job
   */
  artifacts: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = inMemoryJobs[input.jobId];

      if (!job) {
        throw new Error(`Job ${input.jobId} not found`);
      }

      console.log(`[jobs.artifacts] Retrieved artifacts for job ${input.jobId}`);

      return {
        jobId: input.jobId,
        download: job.download,
        separation: job.separation,
        lyrics: job.lyrics,
        audacity: job.audacity,
      };
    }),

  /**
   * Health check
   */
  health: publicProcedure.query(() => {
    console.log("[jobs.health] Health check");
    return {
      status: "ok",
      timestamp: new Date(),
      jobsCount: Object.keys(inMemoryJobs).length,
    };
  }),

  /**
   * Simulate job state transitions (for testing UI)
   * In production, this will be driven by workers
   */
  simulateProgress: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const job = inMemoryJobs[input.jobId];

      if (!job) {
        throw new Error(`Job ${input.jobId} not found`);
      }

      // Simulate state progression
      const transitions: Record<string, string> = {
        NEW: "CLAIMED",
        CLAIMED: "RUNNING",
        RUNNING: "DONE",
      };

      const nextState = transitions[job.state];

      if (nextState) {
        job.state = nextState as any;
        job.updated_at = new Date().toISOString();

        if (nextState === "DONE") {
          job.download = { status: "COMPLETE" };
          job.separation = { status: "COMPLETE" };
          job.title = "Example Song";
          job.artist = "Example Artist";
        }

        console.log(
          `[jobs.simulateProgress] Transitioned job ${input.jobId} to ${nextState}`
        );
      }

      return {
        jobId: job.jobId,
        state: job.state,
        metadata: job,
      };
    }),

  /**
   * Simulate job failure (for testing UI)
   */
  simulateFailure: publicProcedure
    .input(
      z.object({
        jobId: z.string(),
        reason: z.enum([
          "CAPTCHA_REQUIRED",
          "RATE_LIMITED",
          "COPYRIGHT_RESTRICTED",
          "DOWNLOAD_ERROR",
        ]),
      })
    )
    .mutation(async ({ input }) => {
      const job = inMemoryJobs[input.jobId];

      if (!job) {
        throw new Error(`Job ${input.jobId} not found`);
      }

      job.state = "FAILED";
      job.updated_at = new Date().toISOString();
      job.download = {
        status: "FAILED",
        reason: input.reason,
        message: `Download failed: ${input.reason}`,
      };

      console.log(
        `[jobs.simulateFailure] Job ${input.jobId} failed with reason ${input.reason}`
      );

      return {
        jobId: job.jobId,
        state: job.state,
        metadata: job,
      };
    }),
});
