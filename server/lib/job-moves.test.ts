import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { createFilesystem, JOB_STATES } from "./filesystem";
import { Actor } from "./job-state";
import { createMoveOperations } from "./job-moves";

// Use a temporary directory for tests (unique per test run)
const TEST_STORAGE_ROOT = "/tmp/ego-studio-jobs-test-moves";

describe.sequential("Atomic State Transitions", () => {
  let filesystem: ReturnType<typeof createFilesystem>;
  let moves: ReturnType<typeof createMoveOperations>;
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = `${TEST_STORAGE_ROOT}-${Date.now()}-${Math.random()}`;
    await fs.ensureDir(testDir);

    // Create filesystem instance with unique test storage root
    filesystem = createFilesystem(testDir);

    // Create move operations with test filesystem
    moves = createMoveOperations(filesystem, testDir);

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

  describe("moveJob", () => {
    it("should move job from NEW to CLAIMED", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Verify initial state
      let stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.NEW);

      // Move to CLAIMED
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Verify new state
      stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);

      // Verify metadata updated
      const metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should move job from CLAIMED to RUNNING", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.RUNNING);
    });

    it("should move job from RUNNING to DONE", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.DONE);
    });

    it("should move job from RUNNING to FAILED", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);

      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.FAILED, Actor.DOWNLOAD_WORKER);

      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.FAILED);
    });

    it("should reject invalid transition", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Try to move from NEW to RUNNING (invalid)
      await expect(moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.RUNNING, Actor.SYSTEM)).rejects.toThrow();
    });

    it("should reject unauthorized actor", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Try to move from CLAIMED to RUNNING as SYSTEM (not authorized)
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      await expect(
        moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.SYSTEM)
      ).rejects.toThrow("not authorized");
    });

    it("should throw for non-existent job", async () => {
      await expect(
        moves.moveJob("non-existent-job-id", JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM)
      ).rejects.toThrow("not found");
    });

    it("should be atomic (no partial states)", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Get initial directory
      const newDir = path.join(testDir, "jobs", JOB_STATES.NEW, jobId);
      expect(await fs.pathExists(newDir)).toBe(true);

      // Move to CLAIMED
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Verify old directory is gone
      expect(await fs.pathExists(newDir)).toBe(false);

      // Verify new directory exists
      const claimedDir = path.join(testDir, "jobs", JOB_STATES.CLAIMED, jobId);
      expect(await fs.pathExists(claimedDir)).toBe(true);
    });
  });

  describe("moveJobIdempotent", () => {
    it("should succeed if already in target state", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      // Move to CLAIMED
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Try to move again (idempotent)
      const result = await moves.moveJobIdempotent(jobId, JOB_STATES.CLAIMED, JOB_STATES.CLAIMED, Actor.SYSTEM);

      expect(result).toBe(true);

      // Verify still in CLAIMED
      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should perform move if not in target state", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");

      const result = await moves.moveJobIdempotent(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      expect(result).toBe(true);

      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should throw if in unexpected state", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Try to move from NEW when job is in CLAIMED
      await expect(
        moves.moveJobIdempotent(jobId, JOB_STATES.NEW, JOB_STATES.RUNNING, Actor.SYSTEM)
      ).rejects.toThrow();
    });
  });

  describe("reclaimJob", () => {
    it("should reclaim job from CLAIMED if lease expired", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Set lease to past
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata) {
        metadata.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
        // Manually write to filesystem to bypass writeMetadata timestamp update
        const stateDir = await filesystem.getJobStateDir(jobId);
        if (stateDir) {
          await fs.writeJSON(path.join(stateDir.dir, "metadata.json"), metadata, { spaces: 2 });
        }
      }

      // Reclaim
      await moves.reclaimJob(jobId);

      // Verify back in NEW
      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.NEW);
    });

    it("should not reclaim if lease still valid", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);

      // Set lease to future
      const metadata = await filesystem.readMetadata(jobId);
      if (metadata) {
        metadata.leaseExpiresAt = new Date(Date.now() + 10000).toISOString();
        const stateDir = await filesystem.getJobStateDir(jobId);
        if (stateDir) {
          await fs.writeJSON(path.join(stateDir.dir, "metadata.json"), metadata, { spaces: 2 });
        }
      }

      // Try to reclaim
      await moves.reclaimJob(jobId);

      // Verify still in CLAIMED
      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should not reclaim if already in terminal state", async () => {
      const { jobId } = await filesystem.createJobFolder("https://youtube.com/watch?v=test");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Try to reclaim
      await moves.reclaimJob(jobId);

      // Verify still in DONE
      const stateDir = await filesystem.getJobStateDir(jobId);
      expect(stateDir?.state).toBe(JOB_STATES.DONE);
    });
  });
});
