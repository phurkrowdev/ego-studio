import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import * as JobsService from "../lib/jobs-service";

/**
 * Jobs Router
 *
 * Public API endpoints for job management.
 * All handlers delegate to JobsService which wraps Phase 0 infrastructure.
 *
 * Contract:
 * - No endpoints added, removed, or renamed
 * - Input/output shapes unchanged
 * - UI works without modification
 *
 * Implementation:
 * - Filesystem is authority (single source of truth)
 * - State machine validates all transitions
 * - Atomic moves guarantee consistency
 */

export const jobsRouter = router({
  /**
   * Create a new job from a YouTube URL
   */
  create: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const result = await JobsService.createJob(input.url);
      return result;
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
      const results = await JobsService.listJobs({
        limit: input.limit,
        offset: input.offset,
        state: input.state,
      });
      return results;
    }),

  /**
   * Get a single job by ID
   */
  get: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const result = await JobsService.getJob(input.jobId);
      return result;
    }),

  /**
   * Get logs for a job
   */
  logs: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const result = await JobsService.getJobLogs(input.jobId);
      return result;
    }),

  /**
   * Get artifacts for a job
   */
  artifacts: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const result = await JobsService.getJobArtifacts(input.jobId);
      return result;
    }),

  /**
   * Health check
   */
  health: publicProcedure.query(async () => {
    const result = await JobsService.health();
    return result;
  }),

  /**
   * Simulate job state transitions (for testing UI)
   * In production, this will be driven by workers
   */
  simulateProgress: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const result = await JobsService.simulateProgress(input.jobId);
      return result;
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
      const result = await JobsService.simulateFailure(input.jobId, input.reason);
      return result;
    }),
});
