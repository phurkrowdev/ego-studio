import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import { retryJob } from "./jobs-service-retry";
import { createFilesystem } from "./filesystem";
import { createMoveOperations } from "./job-moves";
import * as JobsService from "./jobs-service";

const TEST_STORAGE_ROOT = "/tmp/ego-studio-retry-test";

describe.sequential("Retry Logic", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = `${TEST_STORAGE_ROOT}-${Date.now()}-${Math.random()}`;
    await fs.ensureDir(testDir);
    process.env.STORAGE_ROOT = testDir;
  });

  afterEach(async () => {
    try {
      if (testDir) {
        await fs.remove(testDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    delete process.env.STORAGE_ROOT;
  });

  describe("retryJob", () => {
    it("should transition FAILED job back to NEW", async () => {
      // Create a job
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Transition to FAILED
      await JobsService.simulateProgress(job.jobId); // NEW -> CLAIMED
      await JobsService.simulateProgress(job.jobId); // CLAIMED -> RUNNING
      await JobsService.simulateFailure(job.jobId, "CAPTCHA_REQUIRED");

      // Verify it's FAILED
      let current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("FAILED");

      // Retry the job
      const result = await retryJob(job.jobId, "User retry");

      expect(result.jobId).toBe(job.jobId);
      expect(result.state).toBe("NEW");
      expect(result.message).toContain("reset");

      // Verify state changed
      current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("NEW");
    });

    it("should log retry reason", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Transition to FAILED
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateFailure(job.jobId, "RATE_LIMITED");

      // Retry with custom reason
      const customReason = "User requested retry due to network issue";
      await retryJob(job.jobId, customReason);

      // Check logs contain retry reason
      const logsResult = await JobsService.getJobLogs(job.jobId);
      const hasRetryLog = logsResult.logs.some((log) => log.includes(customReason));
      expect(hasRetryLog).toBe(true);
    });

    it("should throw when retrying non-FAILED job", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Try to retry NEW job
      await expect(retryJob(job.jobId)).rejects.toThrow("Cannot retry job in state NEW");
    });

    it("should throw when retrying DONE job", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Transition to DONE
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);

      // Try to retry DONE job
      await expect(retryJob(job.jobId)).rejects.toThrow("Cannot retry job in state DONE");
    });

    it("should clear failure info when retrying", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Transition to FAILED with reason
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateFailure(job.jobId, "COPYRIGHT_RESTRICTED");

      // Verify failure info exists
      let artifacts = await JobsService.getJobArtifacts(job.jobId);
      expect(artifacts.download?.status).toBe("FAILED");
      expect(artifacts.download?.reason).toBe("COPYRIGHT_RESTRICTED");

      // Retry
      await retryJob(job.jobId);

      // Verify failure info is cleared
      artifacts = await JobsService.getJobArtifacts(job.jobId);
      expect(artifacts.download).toBeUndefined();
    });

    it("should support multiple retries", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // First failure
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateFailure(job.jobId, "RATE_LIMITED");

      let current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("FAILED");

      // First retry
      await retryJob(job.jobId, "First retry");
      current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("NEW");

      // Transition to FAILED again
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateFailure(job.jobId, "DOWNLOAD_ERROR");

      current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("FAILED");

      // Second retry
      await retryJob(job.jobId, "Second retry");
      current = await JobsService.getJob(job.jobId);
      expect(current.state).toBe("NEW");
    });
  });
});
