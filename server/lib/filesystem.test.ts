import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { createFilesystem, JOB_STATES } from "./filesystem";

// Use a temporary directory for tests (unique per test run)
const TEST_STORAGE_ROOT = `/tmp/ego-studio-jobs-test-filesystem-${Date.now()}`;

describe.sequential("Filesystem Module", () => {
  let filesystem: ReturnType<typeof createFilesystem>;
  let testDir: string;

  beforeEach(async () => {
    // Clean and recreate test directory for each test
    testDir = `${TEST_STORAGE_ROOT}-${Date.now()}-${Math.random()}`;
    await fs.ensureDir(testDir);

    // Create filesystem instance with unique test storage root
    filesystem = createFilesystem(testDir);

    // Initialize storage
    await filesystem.initializeStorage();
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      if (testDir) {
        await fs.remove(testDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("initializeStorage", () => {
    it("should create all state directories", async () => {
      for (const state of Object.values(JOB_STATES)) {
        const dir = path.join(testDir, "jobs", state);
        expect(await fs.pathExists(dir)).toBe(true);
      }
    });
  });

  describe("createJobFolder", () => {
    it("should create a job in NEW state", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const { jobId, metadata } = await filesystem.createJobFolder(url);

      expect(jobId).toBeDefined();
      expect(metadata.state).toBe(JOB_STATES.NEW);
      expect(metadata.youtubeUrl).toBe(url);
      expect(metadata.createdAt).toBeDefined();

      // Verify folder exists
      const jobDir = path.join(testDir, "jobs", JOB_STATES.NEW, jobId);
      expect(await fs.pathExists(jobDir)).toBe(true);

      // Verify metadata file exists
      const metadataPath = path.join(jobDir, "metadata.json");
      expect(await fs.pathExists(metadataPath)).toBe(true);

      // Verify logs directory exists
      const logsDir = path.join(jobDir, "logs");
      expect(await fs.pathExists(logsDir)).toBe(true);
    });
  });

  describe("readMetadata", () => {
    it("should read metadata from filesystem", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const { jobId } = await filesystem.createJobFolder(url);

      const readData = await filesystem.readMetadata(jobId);

      expect(readData).toBeDefined();
      expect(readData?.id).toBe(jobId);
      expect(readData?.youtubeUrl).toBe(url);
      expect(readData?.state).toBe(JOB_STATES.NEW);
    });

    it("should return null for non-existent job", async () => {
      const result = await filesystem.readMetadata("non-existent-job-id");
      expect(result).toBeNull();
    });
  });

  describe("writeMetadata", () => {
    it("should update metadata", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const { jobId, metadata } = await filesystem.createJobFolder(url);

      // Update metadata
      metadata.download = {
        status: "COMPLETE",
        title: "Test Video",
        artist: "Test Artist",
      };

      await filesystem.writeMetadata(jobId, metadata);

      // Read back
      const updated = await filesystem.readMetadata(jobId);
      expect(updated?.download?.title).toBe("Test Video");
      expect(updated?.download?.artist).toBe("Test Artist");
    });
  });

  describe("getJobStateDir", () => {
    it("should return correct state directory", async () => {
      const url = "https://youtube.com/watch?v=test123";
      const { jobId } = await filesystem.createJobFolder(url);

      const result = await filesystem.getJobStateDir(jobId);

      expect(result).toBeDefined();
      expect(result?.state).toBe(JOB_STATES.NEW);
      expect(result?.dir).toContain(jobId);
    });

    it("should return null for non-existent job", async () => {
      const result = await filesystem.getJobStateDir("non-existent-job-id");
      expect(result).toBeNull();
    });
  });

  describe("listJobsByState", () => {
    it("should list jobs in a specific state", async () => {
      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const { jobId: jobId1 } = await filesystem.createJobFolder(url1);
      const { jobId: jobId2 } = await filesystem.createJobFolder(url2);

      const jobs = await filesystem.listJobsByState(JOB_STATES.NEW);

      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.some((j) => j === jobId1)).toBe(true);
      expect(jobs.some((j) => j === jobId2)).toBe(true);
    });

    it("should return empty array for empty state", async () => {
      const jobs = await filesystem.listJobsByState(JOB_STATES.DONE);
      expect(jobs).toHaveLength(0);
    });
  });

  describe("listAllJobs", () => {
    it("should list all jobs across all states", async () => {
      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const { jobId: jobId1 } = await filesystem.createJobFolder(url1);
      const { jobId: jobId2 } = await filesystem.createJobFolder(url2);

      const allJobs = await filesystem.listAllJobs();

      expect(allJobs.length).toBeGreaterThanOrEqual(2);
      const jobIds = allJobs.map((j) => j.jobId);
      expect(jobIds.some((id) => id === jobId1)).toBe(true);
      expect(jobIds.some((id) => id === jobId2)).toBe(true);
      expect(allJobs[0].metadata).toBeDefined();
    });
  });

  describe("appendToJobLog", () => {
    it("should append to job log", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      await filesystem.appendToJobLog(jobId, "Test log message 1");
      await filesystem.appendToJobLog(jobId, "Test log message 2");

      const logs = await filesystem.readJobLogs(jobId);

      expect(logs.length).toBeGreaterThanOrEqual(2);
      const logContent = logs.join("\n");
      expect(logContent).toContain("Test log message 1");
      expect(logContent).toContain("Test log message 2");
    });

    it("should throw for non-existent job", async () => {
      await expect(filesystem.appendToJobLog("non-existent-job-id", "Test")).rejects.toThrow();
    });
  });

  describe("readJobLogs", () => {
    it("should read job logs", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      const initialLogs = await filesystem.readJobLogs(jobId);
      expect(Array.isArray(initialLogs)).toBe(true);

      await filesystem.appendToJobLog(jobId, "Message 1");
      await filesystem.appendToJobLog(jobId, "Message 2");

      const logs = await filesystem.readJobLogs(jobId);

      expect(Array.isArray(logs)).toBe(true);
      const logContent = logs.join("\n");
      expect(logContent).toContain("Message 1");
      expect(logContent).toContain("Message 2");
    });
  });

  describe("deleteJobFolder", () => {
    it("should delete job folder", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Verify it exists
      const before = await filesystem.getJobStateDir(jobId);
      expect(before).toBeDefined();

      // Delete
      await filesystem.deleteJobFolder(jobId);

      // Verify it's gone
      const after = await filesystem.getJobStateDir(jobId);
      expect(after).toBeNull();
    });

    it("should handle non-existent job gracefully", async () => {
      await filesystem.deleteJobFolder("non-existent-job-id");
      expect(true).toBe(true);
    });
  });
});
