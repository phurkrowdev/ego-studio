import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import {
  STORAGE_ROOT,
  JOB_STATES,
  initializeStorage,
  createJobFolder,
  readMetadata,
  writeMetadata,
  getJobStateDir,
  listJobsByState,
  listAllJobs,
  appendToJobLog,
  readJobLogs,
  deleteJobFolder,
} from "./filesystem";

// Use a temporary directory for tests
const TEST_STORAGE_ROOT = "/tmp/ego-studio-jobs-test";

describe("Filesystem Module", () => {
  beforeEach(async () => {
    // Override STORAGE_ROOT for tests
    process.env.STORAGE_ROOT = TEST_STORAGE_ROOT;
    await fs.remove(TEST_STORAGE_ROOT);
    await fs.ensureDir(TEST_STORAGE_ROOT);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.remove(TEST_STORAGE_ROOT);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("initializeStorage", () => {
    it("should create all state directories", async () => {
      await initializeStorage();

      for (const state of Object.values(JOB_STATES)) {
        const dir = path.join(TEST_STORAGE_ROOT, "jobs", state);
        expect(await fs.pathExists(dir)).toBe(true);
      }
    });
  });

  describe("createJobFolder", () => {
    it("should create a job in NEW state", async () => {
      await initializeStorage();

      const url = "https://youtube.com/watch?v=test123";
      const { jobId, metadata } = await createJobFolder(url);

      expect(jobId).toBeDefined();
      expect(metadata.state).toBe(JOB_STATES.NEW);
      expect(metadata.youtubeUrl).toBe(url);
      expect(metadata.createdAt).toBeDefined();

      // Verify folder exists
      const jobDir = path.join(TEST_STORAGE_ROOT, "jobs", JOB_STATES.NEW, jobId);
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
      await initializeStorage();

      const url = "https://youtube.com/watch?v=test123";
      const { jobId, metadata: createdMetadata } = await createJobFolder(url);

      const readData = await readMetadata(jobId);

      expect(readData).toBeDefined();
      expect(readData?.id).toBe(jobId);
      expect(readData?.youtubeUrl).toBe(url);
      expect(readData?.state).toBe(JOB_STATES.NEW);
    });

    it("should return null for non-existent job", async () => {
      await initializeStorage();

      const result = await readMetadata("non-existent-job-id");
      expect(result).toBeNull();
    });
  });

  describe("writeMetadata", () => {
    it("should update metadata", async () => {
      await initializeStorage();

      const url = "https://youtube.com/watch?v=test123";
      const { jobId, metadata } = await createJobFolder(url);

      // Update metadata
      metadata.download = {
        status: "COMPLETE",
        title: "Test Video",
        artist: "Test Artist",
      };

      await writeMetadata(jobId, metadata);

      // Read back
      const updated = await readMetadata(jobId);
      expect(updated?.download?.title).toBe("Test Video");
      expect(updated?.download?.artist).toBe("Test Artist");
    });
  });

  describe("getJobStateDir", () => {
    it("should return correct state directory", async () => {
      await initializeStorage();

      const url = "https://youtube.com/watch?v=test123";
      const { jobId } = await createJobFolder(url);

      const result = await getJobStateDir(jobId);

      expect(result).toBeDefined();
      expect(result?.state).toBe(JOB_STATES.NEW);
      expect(result?.dir).toContain(jobId);
    });

    it("should return null for non-existent job", async () => {
      await initializeStorage();

      const result = await getJobStateDir("non-existent-job-id");
      expect(result).toBeNull();
    });
  });

  describe("listJobsByState", () => {
    it("should list jobs in a specific state", async () => {
      await initializeStorage();

      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const { jobId: jobId1 } = await createJobFolder(url1);
      const { jobId: jobId2 } = await createJobFolder(url2);

      const jobs = await listJobsByState(JOB_STATES.NEW);

      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs).toContain(jobId1);
      expect(jobs).toContain(jobId2);
    });

    it("should return empty array for empty state", async () => {
      await initializeStorage();

      const jobs = await listJobsByState(JOB_STATES.DONE);
      expect(jobs).toHaveLength(0);
    });
  });

  describe("listAllJobs", () => {
    it("should list all jobs across all states", async () => {
      await initializeStorage();

      const url1 = "https://youtube.com/watch?v=test1";
      const url2 = "https://youtube.com/watch?v=test2";

      const { jobId: jobId1 } = await createJobFolder(url1);
      const { jobId: jobId2 } = await createJobFolder(url2);

      const allJobs = await listAllJobs();

      expect(allJobs.length).toBeGreaterThanOrEqual(2);
      const jobIds = allJobs.map((j) => j.jobId);
      expect(jobIds).toContain(jobId1);
      expect(jobIds).toContain(jobId2);
      expect(allJobs[0].metadata).toBeDefined();
    });
  });

  describe("appendToJobLog", () => {
    it("should append to job log", async () => {
      await initializeStorage();

      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      await appendToJobLog(jobId, "Test log message 1");
      await appendToJobLog(jobId, "Test log message 2");

      const logs = await readJobLogs(jobId);

      expect(logs.length).toBeGreaterThanOrEqual(2);
      const logContent = logs.join("\n");
      expect(logContent).toContain("Test log message 1");
      expect(logContent).toContain("Test log message 2");
    });

    it("should throw for non-existent job", async () => {
      await initializeStorage();

      await expect(appendToJobLog("non-existent-job-id", "Test")).rejects.toThrow();
    });
  });

  describe("readJobLogs", () => {
    it("should read job logs", async () => {
      await initializeStorage();

      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      await appendToJobLog(jobId, "Message 1");
      await appendToJobLog(jobId, "Message 2");

      const logs = await readJobLogs(jobId);

      expect(Array.isArray(logs)).toBe(true);
      const logContent = logs.join("\n");
      expect(logContent).toContain("Message 1");
      expect(logContent).toContain("Message 2");
    });
  });

  describe("deleteJobFolder", () => {
    it("should delete job folder", async () => {
      await initializeStorage();

      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Verify it exists
      const before = await getJobStateDir(jobId);
      expect(before).toBeDefined();

      // Delete
      await deleteJobFolder(jobId);

      // Verify it's gone
      const after = await getJobStateDir(jobId);
      expect(after).toBeNull();
    });

    it("should handle non-existent job gracefully", async () => {
      await initializeStorage();

      // Should not throw for non-existent job
      try {
        await deleteJobFolder("non-existent-job-id");
      } catch (e) {
        expect(false).toBe(true);
      }
    });
  });
});
