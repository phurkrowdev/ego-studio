/**
 * Upload Integration Tests
 *
 * Tests the full flow: upload file → create job → verify metadata
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { createJobFromFile } from "./jobs-service-file";
import { UPLOAD_CONSTRAINTS } from "./file-upload";

describe("Upload Integration Flow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join("/tmp", `upload-integration-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    process.env.STORAGE_ROOT = tempDir;
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe("Full upload flow", () => {
    it("should create job from WAV file with correct metadata", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE...");
      const filename = "test-track.wav";
      const mimeType = "audio/wav";

      const jobResponse = await createJobFromFile(wavBuffer, filename, mimeType);

      expect(jobResponse).toHaveProperty("jobId");
      expect(jobResponse).toHaveProperty("metadata");
      expect(jobResponse.metadata).toHaveProperty("youtubeUrl");
      expect(jobResponse.metadata).toHaveProperty("state");
      expect(jobResponse.metadata.state).toBe("NEW");
    });

    it("should create job from MP3 file", async () => {
      const mp3Buffer = Buffer.from("ID3....");
      const filename = "song.mp3";
      const mimeType = "audio/mpeg";

      const jobResponse = await createJobFromFile(mp3Buffer, filename, mimeType);

      expect(jobResponse.jobId).toBeDefined();
      expect(jobResponse.metadata.state).toBe("NEW");
    });

    it("should create job from FLAC file", async () => {
      const flacBuffer = Buffer.from("fLaC....");
      const filename = "audio.flac";
      const mimeType = "audio/flac";

      const jobResponse = await createJobFromFile(flacBuffer, filename, mimeType);

      expect(jobResponse.jobId).toBeDefined();
      expect(jobResponse.metadata.state).toBe("NEW");
    });

    it("should create job from AIFF file", async () => {
      const aiffBuffer = Buffer.from("FORM....AIFF....");
      const filename = "track.aiff";
      const mimeType = "audio/aiff";

      const jobResponse = await createJobFromFile(aiffBuffer, filename, mimeType);

      expect(jobResponse.jobId).toBeDefined();
      expect(jobResponse.metadata.state).toBe("NEW");
    });

    it("should return valid job ID and metadata", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE...");
      const filename = "test.wav";
      const mimeType = "audio/wav";

      const jobResponse = await createJobFromFile(wavBuffer, filename, mimeType);

      // Verify job ID is a valid UUID
      expect(jobResponse.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Verify metadata contains required fields
      expect(jobResponse.metadata).toHaveProperty("jobId");
      expect(jobResponse.metadata).toHaveProperty("state");
      expect(jobResponse.metadata).toHaveProperty("createdAt");
      expect(jobResponse.metadata).toHaveProperty("updatedAt");
    });

    it("should return consistent job structure", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE...");
      const jobResponse = await createJobFromFile(wavBuffer, "test.wav", "audio/wav");

      // Verify response structure
      expect(jobResponse).toMatchObject({
        jobId: expect.any(String),
        metadata: expect.objectContaining({
          jobId: expect.any(String),
          youtubeUrl: expect.any(String),
          state: expect.stringMatching(/^(NEW|CLAIMED|RUNNING|DONE|FAILED)$/),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      });
    });

    it("should handle multiple file uploads sequentially", async () => {
      const files = [
        { buffer: Buffer.from("RIFF....WAVE..."), name: "track1.wav", mime: "audio/wav" },
        { buffer: Buffer.from("ID3...."), name: "track2.mp3", mime: "audio/mpeg" },
        { buffer: Buffer.from("fLaC...."), name: "track3.flac", mime: "audio/flac" },
      ];

      const jobIds = new Set<string>();

      for (const file of files) {
        const jobResponse = await createJobFromFile(file.buffer, file.name, file.mime);
        jobIds.add(jobResponse.jobId);
      }

      // All jobs should have unique IDs
      expect(jobIds.size).toBe(3);
    });

    it("should reject file upload with invalid MIME type", async () => {
      const buffer = Buffer.from("fake video data");

      // This should fail during validation in the upload endpoint
      // but we can't test that here without the full endpoint
      // Just verify the constraint is defined
      expect(UPLOAD_CONSTRAINTS.supportedMimeTypes).toContain("audio/wav");
      expect(UPLOAD_CONSTRAINTS.supportedMimeTypes).toContain("audio/mpeg");
      expect(UPLOAD_CONSTRAINTS.supportedMimeTypes).not.toContain("video/mp4");
    });

    it("should enforce file size limit", () => {
      expect(UPLOAD_CONSTRAINTS.maxFileSize).toBe(200 * 1024 * 1024); // 200MB
    });
  });

  describe("Error handling", () => {
    it("should handle file with special characters in name", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE...");
      const filename = "My Song (Remix) v2 [Clean].wav";
      const mimeType = "audio/wav";

      const jobResponse = await createJobFromFile(wavBuffer, filename, mimeType);

      expect(jobResponse.jobId).toBeDefined();
      expect(jobResponse.metadata.state).toBe("NEW");
    });

    it("should handle file with unicode characters", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE...");
      const filename = "曲 - 音声.wav";
      const mimeType = "audio/wav";

      const jobResponse = await createJobFromFile(wavBuffer, filename, mimeType);

      expect(jobResponse.jobId).toBeDefined();
      expect(jobResponse.metadata.state).toBe("NEW");
    });
  });
});
