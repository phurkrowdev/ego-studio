import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { JOB_STATES } from "./filesystem";
import { Actor } from "./job-state";
import { moveJob, moveJobIdempotent, reclaimJob } from "./job-moves";
import { createJobFolder, readMetadata, getJobStateDir, deleteJobFolder, initializeStorage } from "./filesystem";

// Use a temporary directory for tests
const TEST_STORAGE_ROOT = "/tmp/ego-studio-jobs-test";

describe("Atomic State Transitions", () => {
  beforeEach(async () => {
    process.env.STORAGE_ROOT = TEST_STORAGE_ROOT;
    await fs.remove(TEST_STORAGE_ROOT);
    await fs.ensureDir(TEST_STORAGE_ROOT);

    // Initialize state directories
    await initializeStorage();
  });

  afterEach(async () => {
    try {
      await fs.remove(TEST_STORAGE_ROOT);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("moveJob", () => {
    it("should move job from NEW to CLAIMED", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Verify initial state
      let stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.NEW);

      // Move to CLAIMED
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Verify new state
      stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);

      // Verify metadata updated
      const metadata = await readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should move job from CLAIMED to RUNNING", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      await moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.RUNNING);
    });

    it("should move job from RUNNING to DONE", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      await moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.DONE);
    });

    it("should move job from RUNNING to FAILED", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      await moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.FAILED, Actor.DOWNLOAD_WORKER);

      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.FAILED);
    });

    it("should reject invalid transition", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Try to move from NEW to RUNNING (invalid)
      await expect(moveJob(jobId, JOB_STATES.NEW, JOB_STATES.RUNNING, Actor.SYSTEM)).rejects.toThrow();
    });

    it("should reject unauthorized actor", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Try to move from CLAIMED to RUNNING as SYSTEM (not authorized)
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      await expect(
        moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.SYSTEM)
      ).rejects.toThrow("not authorized");
    });

    it("should throw for non-existent job", async () => {
      await expect(
        moveJob("non-existent-job-id", JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM)
      ).rejects.toThrow("not found");
    });

    it("should be atomic (no partial states)", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Get initial directory
      const newDir = path.join(TEST_STORAGE_ROOT, "jobs", JOB_STATES.NEW, jobId);
      expect(await fs.pathExists(newDir)).toBe(true);

      // Move to CLAIMED
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Verify old directory is gone
      expect(await fs.pathExists(newDir)).toBe(false);

      // Verify new directory exists
      const claimedDir = path.join(TEST_STORAGE_ROOT, "jobs", JOB_STATES.CLAIMED, jobId);
      expect(await fs.pathExists(claimedDir)).toBe(true);
    });
  });

  describe("moveJobIdempotent", () => {
    it("should succeed if already in target state", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      // Move to CLAIMED
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Try to move again (idempotent)
      const result = await moveJobIdempotent(jobId, JOB_STATES.CLAIMED, JOB_STATES.CLAIMED, Actor.SYSTEM);

      expect(result).toBe(true);

      // Verify still in CLAIMED
      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should perform move if not in target state", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");

      const result = await moveJobIdempotent(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      expect(result).toBe(true);

      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should throw if in unexpected state", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Try to move from NEW when job is in CLAIMED
      await expect(
        moveJobIdempotent(jobId, JOB_STATES.NEW, JOB_STATES.RUNNING, Actor.SYSTEM)
      ).rejects.toThrow();
    });
  });

  describe("reclaimJob", () => {
    it("should reclaim job from CLAIMED if lease expired", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Set lease to past
      const metadata = await readMetadata(jobId);
      if (metadata) {
        metadata.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
        // Manually write to filesystem to bypass writeMetadata timestamp update
        const stateDir = await getJobStateDir(jobId);
        if (stateDir) {
          await fs.writeJSON(path.join(stateDir.dir, "metadata.json"), metadata, { spaces: 2 });
        }
      }

      // Reclaim
      await reclaimJob(jobId);

      // Verify back in NEW
      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.NEW);
    });

    it("should not reclaim if lease still valid", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Set lease to future
      const metadata = await readMetadata(jobId);
      if (metadata) {
        metadata.leaseExpiresAt = new Date(Date.now() + 10000).toISOString();
        const stateDir = await getJobStateDir(jobId);
        if (stateDir) {
          await fs.writeJSON(path.join(stateDir.dir, "metadata.json"), metadata, { spaces: 2 });
        }
      }

      // Try to reclaim
      await reclaimJob(jobId);

      // Verify still in CLAIMED
      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should not reclaim if already in terminal state", async () => {
      const { jobId } = await createJobFolder("https://youtube.com/watch?v=test");
      await moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Try to reclaim
      await reclaimJob(jobId);

      // Verify still in DONE
      const stateDir = await getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.DONE);
    });
  });
});
