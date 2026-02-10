import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import * as JobsService from "./jobs-service";
import { createFilesystem } from "./filesystem";
import { createMoveOperations } from "./job-moves";

// Use a temporary directory for tests
const TEST_STORAGE_ROOT = "/tmp/ego-studio-jobs-service-test";

describe.sequential("JobsService Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testDir = `${TEST_STORAGE_ROOT}-${Date.now()}-${Math.random()}`;
    await fs.ensureDir(testDir);

    // Set environment variable for JobsService to use
    process.env.STORAGE_ROOT = testDir;
  });

  afterEach(async () => {
    // Cleanup
    try {
      if (testDir) {
        await fs.remove(testDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    delete process.env.STORAGE_ROOT;
  });

  describe("createJob", () => {
    it("should create a job and return correct response shape", async () => {
      const url = "https://youtube.com/watch?v=test123";

      const result = await JobsService.createJob(url);

      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
      expect(result.state).toBe("NEW");
      expect(result.metadata).toBeDefined();
      expect(result.metadata.youtubeUrl).toBe(url);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("listJobs", () => {
    it("should list all jobs", async () => {
      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const job1 = await JobsService.createJob(url1);
      const job2 = await JobsService.createJob(url2);

      const jobs = await JobsService.listJobs({});

      expect(jobs.length).toBeGreaterThanOrEqual(2);
      const jobIds = jobs.map((j) => j.jobId);
      expect(jobIds).toContain(job1.jobId);
      expect(jobIds).toContain(job2.jobId);
    });

    it("should filter jobs by state", async () => {
      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const job1 = await JobsService.createJob(url1);
      const job2 = await JobsService.createJob(url2);

      // Transition job1 to CLAIMED
      await JobsService.simulateProgress(job1.jobId);

      const newJobs = await JobsService.listJobs({ state: "NEW" });
      const claimedJobs = await JobsService.listJobs({ state: "CLAIMED" });

      expect(newJobs.length).toBeGreaterThanOrEqual(1);
      expect(claimedJobs.length).toBeGreaterThanOrEqual(1);

      // Verify filtering
      const newJobIds = newJobs.map((j) => j.jobId);
      const claimedJobIds = claimedJobs.map((j) => j.jobId);

      expect(newJobIds).toContain(job2.jobId);
      expect(claimedJobIds).toContain(job1.jobId);
    });

    it("should respect pagination", async () => {
      // Create 5 jobs
      for (let i = 0; i < 5; i++) {
        await JobsService.createJob(`https://youtube.com/watch?v=test${i}`);
      }

      const page1 = await JobsService.listJobs({ limit: 2, offset: 0 });
      const page2 = await JobsService.listJobs({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);

      // Verify pagination returns different jobs
      const page1Ids = page1.map((j) => j.jobId);
      const page2Ids = page2.map((j) => j.jobId);
      const totalJobs = new Set([...page1Ids, ...page2Ids]);
      expect(totalJobs.size).toBeGreaterThanOrEqual(Math.min(4, 5));
    });
  });

  describe("getJob", () => {
    it("should get a job by ID", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const created = await JobsService.createJob(url);

      const retrieved = await JobsService.getJob(created.jobId);

      expect(retrieved.jobId).toBe(created.jobId);
      expect(retrieved.state).toBe("NEW");
      expect(retrieved.metadata.youtubeUrl).toBe(url);
    });

    it("should throw for non-existent job", async () => {
      await expect(JobsService.getJob("non-existent-job-id")).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("getJobLogs", () => {
    it("should get logs for a job", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const job = await JobsService.createJob(url);

      const logs = await JobsService.getJobLogs(job.jobId);

      expect(logs.jobId).toBe(job.jobId);
      expect(Array.isArray(logs.logs)).toBe(true);
      expect(logs.logs.length).toBeGreaterThan(0);
    });

    it("should throw for non-existent job", async () => {
      await expect(
        JobsService.getJobLogs("non-existent-job-id")
      ).rejects.toThrow("not found");
    });
  });

  describe("getJobArtifacts", () => {
    it("should get artifacts for a job", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const job = await JobsService.createJob(url);

      const artifacts = await JobsService.getJobArtifacts(job.jobId);

      expect(artifacts.jobId).toBe(job.jobId);
      expect(artifacts.download).toBeUndefined();
      expect(artifacts.separation).toBeUndefined();
    });

    it("should throw for non-existent job", async () => {
      await expect(
        JobsService.getJobArtifacts("non-existent-job-id")
      ).rejects.toThrow("not found");
    });
  });

  describe("simulateProgress", () => {
    it("should transition job from NEW to CLAIMED", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      const result = await JobsService.simulateProgress(job.jobId);

      expect(result.state).toBe("CLAIMED");
      expect(result.jobId).toBe(job.jobId);
    });

    it("should transition job from CLAIMED to RUNNING", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");
      await JobsService.simulateProgress(job.jobId);

      const result = await JobsService.simulateProgress(job.jobId);

      expect(result.state).toBe("RUNNING");
    });

    it("should transition job from RUNNING to DONE", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);

      const result = await JobsService.simulateProgress(job.jobId);

      expect(result.state).toBe("DONE");
      expect(result.metadata.download?.status).toBe("COMPLETE");
      expect(result.metadata.download?.title).toBe("Example Song");
      expect(result.metadata.download?.artist).toBe("Example Artist");
    });

    it("should not transition if already in terminal state", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);
      await JobsService.simulateProgress(job.jobId);

      const result = await JobsService.simulateProgress(job.jobId);

      expect(result.state).toBe("DONE");
    });
  });

  describe("simulateFailure", () => {
    it("should transition job to FAILED with reason", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");
      await JobsService.simulateProgress(job.jobId); // NEW -> CLAIMED
      await JobsService.simulateProgress(job.jobId); // CLAIMED -> RUNNING

      const result = await JobsService.simulateFailure(job.jobId, "CAPTCHA_REQUIRED");

      expect(result.state).toBe("FAILED");
      expect(result.metadata.download?.status).toBe("FAILED");
      expect(result.metadata.download?.reason).toBe("CAPTCHA_REQUIRED");
    });

    it("should support different failure reasons", async () => {
      const reasons: Array<
        "CAPTCHA_REQUIRED" | "RATE_LIMITED" | "COPYRIGHT_RESTRICTED" | "DOWNLOAD_ERROR"
      > = ["CAPTCHA_REQUIRED", "RATE_LIMITED", "COPYRIGHT_RESTRICTED", "DOWNLOAD_ERROR"];

      for (const reason of reasons) {
        const job = await JobsService.createJob(
          `https://youtube.com/watch?v=test-${reason}`
        );
        await JobsService.simulateProgress(job.jobId); // NEW -> CLAIMED
        await JobsService.simulateProgress(job.jobId); // CLAIMED -> RUNNING

        const result = await JobsService.simulateFailure(job.jobId, reason);

        expect(result.metadata.download?.reason).toBe(reason);
      }
    });

    it("should throw when failing job in NEW state", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      await expect(
        JobsService.simulateFailure(job.jobId, "CAPTCHA_REQUIRED")
      ).rejects.toThrow();
    });
  });

  describe("health", () => {
    it("should return health status", async () => {
      const result = await JobsService.health();

      expect(result.status).toBe("ok");
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.jobsCount).toBeGreaterThanOrEqual(0);
    });

    it("should count jobs correctly", async () => {
      const before = await JobsService.health();

      await JobsService.createJob("https://youtube.com/watch?v=test1");
      await JobsService.createJob("https://youtube.com/watch?v=test2");

      const after = await JobsService.health();

      expect(after.jobsCount).toBe(before.jobsCount + 2);
    });
  });

  describe("API Contract Verification", () => {
    it("should maintain response shape across all operations", async () => {
      const job = await JobsService.createJob("https://youtube.com/watch?v=test");

      // Verify create response
      expect(job).toHaveProperty("jobId");
      expect(job).toHaveProperty("state");
      expect(job).toHaveProperty("metadata");
      expect(job).toHaveProperty("createdAt");
      expect(job).toHaveProperty("updatedAt");

      // Verify get response
      const retrieved = await JobsService.getJob(job.jobId);
      expect(retrieved).toHaveProperty("jobId");
      expect(retrieved).toHaveProperty("state");
      expect(retrieved).toHaveProperty("metadata");
      expect(retrieved).toHaveProperty("createdAt");
      expect(retrieved).toHaveProperty("updatedAt");

      // Verify list response
      const list = await JobsService.listJobs({});
      expect(Array.isArray(list)).toBe(true);
      if (list.length > 0) {
        expect(list[0]).toHaveProperty("jobId");
        expect(list[0]).toHaveProperty("state");
        expect(list[0]).toHaveProperty("metadata");
        expect(list[0]).toHaveProperty("createdAt");
        expect(list[0]).toHaveProperty("updatedAt");
      }

      // Verify progress response
      const progressed = await JobsService.simulateProgress(job.jobId);
      expect(progressed).toHaveProperty("jobId");
      expect(progressed).toHaveProperty("state");
      expect(progressed).toHaveProperty("metadata");

      // Transition to RUNNING before failing
      await JobsService.simulateProgress(job.jobId); // CLAIMED -> RUNNING

      // Verify failure response
      const failed = await JobsService.simulateFailure(job.jobId, "CAPTCHA_REQUIRED");
      expect(failed).toHaveProperty("jobId");
      expect(failed).toHaveProperty("state");
      expect(failed).toHaveProperty("metadata");
    });
  });
});
