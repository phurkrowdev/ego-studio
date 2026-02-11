import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFilesystem, JOB_STATES } from "./filesystem";
import { createMoveOperations } from "./job-moves";
import { Actor } from "./job-state";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

describe("Multi-Stage Pipeline", { sequential: true }, () => {
  let testDir: string;
  let filesystem: ReturnType<typeof createFilesystem>;
  let moves: ReturnType<typeof createMoveOperations>;

  beforeEach(() => {
    testDir = mkdtempSync(join("/tmp", "ego-studio-test-"));
    filesystem = createFilesystem(testDir);
    moves = createMoveOperations(filesystem, testDir);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to cleanup test directory:", err);
    }
  });

  describe("End-to-End Job Progression", () => {
    it("should progress job through yt-dlp stage (NEW → CLAIMED → RUNNING → DONE)", async () => {
      // Create job
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Verify initial state
      let metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.NEW);

      // Simulate yt-dlp: NEW → CLAIMED
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.CLAIMED);

      // Simulate yt-dlp: CLAIMED → RUNNING
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.RUNNING);

      // Simulate yt-dlp: RUNNING → DONE
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.DONE);

      // Verify logs exist
      const logs = await filesystem.readJobLogs(jobId);
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should progress job through Demucs stage after yt-dlp completion", async () => {
      // Create and complete yt-dlp stage
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Simulate yt-dlp completion
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      let metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.DONE);

      // Now simulate Demucs: DONE → CLAIMED
      await moves.moveJob(jobId, JOB_STATES.DONE, JOB_STATES.CLAIMED, Actor.DEMUCS_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.CLAIMED);

      // Demucs: CLAIMED → RUNNING
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DEMUCS_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.RUNNING);

      // Demucs: RUNNING → DONE
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DEMUCS_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.DONE);
    });

    it("should handle Demucs failure and allow retry", async () => {
      // Create and complete yt-dlp stage
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Simulate Demucs failure
      await moves.moveJob(jobId, JOB_STATES.DONE, JOB_STATES.CLAIMED, Actor.DEMUCS_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DEMUCS_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.FAILED, Actor.DEMUCS_WORKER);

      let metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.FAILED);

      // Retry: FAILED → NEW
      await moves.moveJob(jobId, JOB_STATES.FAILED, JOB_STATES.NEW, Actor.SYSTEM);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.NEW);

      // Should be able to restart from beginning
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.CLAIMED);
    });

    it("should track artifacts through pipeline stages", async () => {
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Simulate yt-dlp completion with artifact
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      // Write artifact with unique name to avoid conflicts
      const uniqueAudioName = `audio-${jobId.substring(0, 8)}.wav`;
      await filesystem.writeArtifact(jobId, "download", uniqueAudioName, "Mock audio data");
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Verify artifact exists
      let artifactsByType = await filesystem.listArtifacts(jobId);
      let allArtifacts = Object.values(artifactsByType).flat();
      // Should have at least the audio artifact
      expect(allArtifacts.length).toBeGreaterThanOrEqual(1);
      expect(allArtifacts.some((a) => a === uniqueAudioName)).toBe(true);

      // Simulate Demucs completion with stem artifacts
      await moves.moveJob(jobId, JOB_STATES.DONE, JOB_STATES.CLAIMED, Actor.DEMUCS_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DEMUCS_WORKER);
      // Write stems with unique names to avoid conflicts
      const stemSuffix = jobId.substring(0, 8);
      await filesystem.writeArtifact(jobId, "separation", `vocals-${stemSuffix}.wav`, "Mock vocals");
      await filesystem.writeArtifact(jobId, "separation", `drums-${stemSuffix}.wav`, "Mock drums");
      await filesystem.writeArtifact(jobId, "separation", `bass-${stemSuffix}.wav`, "Mock bass");
      await filesystem.writeArtifact(jobId, "separation", `other-${stemSuffix}.wav`, "Mock other");
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DEMUCS_WORKER);

      // Verify all artifacts exist
      artifactsByType = await filesystem.listArtifacts(jobId);
      allArtifacts = Object.values(artifactsByType).flat();
      // Should have at least 5 artifacts (1 download + 4 stems)
      expect(allArtifacts.length).toBeGreaterThanOrEqual(5);
      expect(allArtifacts.some((a) => a === `vocals-${stemSuffix}.wav`)).toBe(true);
      expect(allArtifacts.some((a) => a === `drums-${stemSuffix}.wav`)).toBe(true);
    });

    it("should maintain logs across all pipeline stages", async () => {
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Simulate yt-dlp
      await filesystem.appendToJobLog(jobId, "[WORKER] Starting yt-dlp");
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await filesystem.appendToJobLog(jobId, "[WORKER] Download started");
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await filesystem.appendToJobLog(jobId, "[WORKER] Download complete");
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Simulate Demucs
      await filesystem.appendToJobLog(jobId, "[DEMUCS-WORKER] Starting separation");
      await moves.moveJob(jobId, JOB_STATES.DONE, JOB_STATES.CLAIMED, Actor.DEMUCS_WORKER);
      await filesystem.appendToJobLog(jobId, "[DEMUCS-WORKER] Separation in progress");
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DEMUCS_WORKER);
      await filesystem.appendToJobLog(jobId, "[DEMUCS-WORKER] Separation complete");
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DEMUCS_WORKER);

      // Verify logs contain all stages
      const logs = await filesystem.readJobLogs(jobId);
      const logContent = logs.join("\n");

      expect(logContent).toContain("[WORKER] Starting yt-dlp");
      expect(logContent).toContain("[WORKER] Download complete");
      expect(logContent).toContain("[DEMUCS-WORKER] Starting separation");
      expect(logContent).toContain("[DEMUCS-WORKER] Separation complete");
    });

    it("should handle yt-dlp failure without blocking retry", async () => {
      const jobId = uuidv4();
      await filesystem.createJobFolder(jobId);
      await filesystem.writeMetadata(jobId, {
        jobId,
        youtubeUrl: "https://youtube.com/watch?v=test",
        state: JOB_STATES.NEW,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Simulate yt-dlp failure
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.FAILED, Actor.DOWNLOAD_WORKER);

      let metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.FAILED);

      // Retry should work
      await moves.moveJob(jobId, JOB_STATES.FAILED, JOB_STATES.NEW, Actor.SYSTEM);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.NEW);

      // Should be able to progress through pipeline again
      await moves.moveJob(jobId, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(jobId, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);
      metadata = await filesystem.readMetadata(jobId);
      expect(metadata?.state).toBe(JOB_STATES.DONE);
    });

    it("should list jobs correctly across pipeline stages", async () => {
      // Create multiple jobs at different stages
      const job1Id = uuidv4();
      const job2Id = uuidv4();
      const job3Id = uuidv4();

      for (const jobId of [job1Id, job2Id, job3Id]) {
        await filesystem.createJobFolder(jobId);
        await filesystem.writeMetadata(jobId, {
          jobId,
          youtubeUrl: `https://youtube.com/watch?v=${jobId}`,
          state: JOB_STATES.NEW,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Progress job1 to yt-dlp completion
      await moves.moveJob(job1Id, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(job1Id, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(job1Id, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);

      // Progress job2 to Demucs stage
      await moves.moveJob(job2Id, JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(job2Id, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(job2Id, JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);
      await moves.moveJob(job2Id, JOB_STATES.DONE, JOB_STATES.CLAIMED, Actor.DEMUCS_WORKER);
      await moves.moveJob(job2Id, JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DEMUCS_WORKER);

      // job3 stays in NEW

      // List all jobs
      const allJobs = await filesystem.listAllJobs();
      
      // Filter to only jobs created in this test
      const testJobs = allJobs.filter((j) => [job1Id, job2Id, job3Id].includes(j.jobId));
      expect(testJobs.length).toBe(3);

      // Verify states
      const states = testJobs.map((j) => j.state).sort();
      expect(states).toEqual(["DONE", "NEW", "RUNNING"]);
    });
  });
});
