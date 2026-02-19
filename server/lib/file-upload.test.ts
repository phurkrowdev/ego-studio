/**
 * File Upload Infrastructure Tests
 *
 * Tests for validation, streaming, and local storage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import {
  validateMimeType,
  validateFileSize,
  sanitizeFilename,
  getFormatFromFilename,
  streamUploadToLocal,
  deleteUploadedFile,
  formatFileSize,
  FileUploadError,
  UPLOAD_CONSTRAINTS,
} from "./file-upload";

describe("File Upload Infrastructure", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join("/tmp", `upload-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe("validateMimeType", () => {
    it("should accept valid audio MIME types", () => {
      expect(validateMimeType("audio/wav")).toBe("wav");
      expect(validateMimeType("audio/mpeg")).toBe("mp3");
      expect(validateMimeType("audio/flac")).toBe("flac");
      expect(validateMimeType("audio/aiff")).toBe("aiff");
    });

    it("should reject invalid MIME types", () => {
      expect(() => validateMimeType("video/mp4")).toThrow(FileUploadError);
      expect(() => validateMimeType("image/png")).toThrow(FileUploadError);
      expect(() => validateMimeType("text/plain")).toThrow(FileUploadError);
    });

    it("should reject empty MIME type", () => {
      expect(() => validateMimeType("")).toThrow(FileUploadError);
    });
  });

  describe("validateFileSize", () => {
    it("should accept files under 200MB", () => {
      expect(() => validateFileSize(1024 * 1024)).not.toThrow(); // 1MB
      expect(() => validateFileSize(100 * 1024 * 1024)).not.toThrow(); // 100MB
      expect(() => validateFileSize(200 * 1024 * 1024)).not.toThrow(); // 200MB
    });

    it("should reject files over 200MB", () => {
      const oversized = 200 * 1024 * 1024 + 1;
      expect(() => validateFileSize(oversized)).toThrow(FileUploadError);
    });

    it("should reject empty files", () => {
      expect(() => validateFileSize(0)).toThrow(FileUploadError);
    });

    it("should reject negative file sizes", () => {
      expect(() => validateFileSize(-1)).toThrow(FileUploadError);
    });
  });

  describe("sanitizeFilename", () => {
    it("should remove path separators", () => {
      expect(sanitizeFilename("../../etc/passwd")).toBe("etcpasswd");
      expect(sanitizeFilename("path/to/file.wav")).toBe("pathtofile.wav");
    });

    it("should replace spaces with underscores", () => {
      expect(sanitizeFilename("my song.wav")).toBe("my_song.wav");
      expect(sanitizeFilename("track  name.mp3")).toBe("track_name.mp3");
    });

    it("should remove special characters", () => {
      expect(sanitizeFilename("song@#$%.wav")).toBe("song.wav");
      expect(sanitizeFilename("track(1).mp3")).toBe("track1.mp3");
    });

    it("should preserve valid characters", () => {
      expect(sanitizeFilename("song-123_v2.wav")).toBe("song-123_v2.wav");
      expect(sanitizeFilename("track.remix.mp3")).toBe("track.remix.mp3");
    });

    it("should truncate long filenames", () => {
      const longName = "a".repeat(300) + ".wav";
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });
  });

  describe("getFormatFromFilename", () => {
    it("should extract format from filename", () => {
      expect(getFormatFromFilename("song.wav")).toBe("wav");
      expect(getFormatFromFilename("track.mp3")).toBe("mp3");
      expect(getFormatFromFilename("audio.flac")).toBe("flac");
      expect(getFormatFromFilename("music.aiff")).toBe("aiff");
    });

    it("should be case-insensitive", () => {
      expect(getFormatFromFilename("song.WAV")).toBe("wav");
      expect(getFormatFromFilename("track.MP3")).toBe("mp3");
      expect(getFormatFromFilename("audio.FLAC")).toBe("flac");
    });

    it("should reject unsupported formats", () => {
      expect(() => getFormatFromFilename("video.mp4")).toThrow(FileUploadError);
      expect(() => getFormatFromFilename("image.png")).toThrow(FileUploadError);
      expect(() => getFormatFromFilename("document.pdf")).toThrow(FileUploadError);
    });

    it("should reject files without extension", () => {
      expect(() => getFormatFromFilename("song")).toThrow(FileUploadError);
    });
  });

  describe("streamUploadToLocal", () => {
    it("should save valid audio file", async () => {
      const buffer = Buffer.from("fake audio data");
      const result = await streamUploadToLocal(
        buffer,
        "song.wav",
        "audio/wav",
        tempDir
      );

      expect(result.metadata.filename).toBe("song.wav");
      expect(result.metadata.format).toBe("wav");
      expect(result.metadata.size).toBe(buffer.length);
      expect(result.metadata.mimeType).toBe("audio/wav");
      expect(result.metadata.s3Key).toBeNull();

      // Verify file exists on disk
      const fileExists = await fs.pathExists(result.localPath);
      expect(fileExists).toBe(true);

      // Verify file content
      const savedContent = await fs.readFile(result.localPath);
      expect(savedContent).toEqual(buffer);
    });

    it("should reject invalid MIME type during upload", async () => {
      const buffer = Buffer.from("fake video data");
      await expect(
        streamUploadToLocal(buffer, "video.mp4", "video/mp4", tempDir)
      ).rejects.toThrow(FileUploadError);
    });

    it("should reject oversized file during upload", async () => {
      const oversized = Buffer.alloc(200 * 1024 * 1024 + 1);
      await expect(
        streamUploadToLocal(oversized, "song.wav", "audio/wav", tempDir)
      ).rejects.toThrow(FileUploadError);
    });

    it("should generate unique filenames to avoid collisions", async () => {
      const buffer1 = Buffer.from("audio data 1");
      const buffer2 = Buffer.from("audio data 2");

      const result1 = await streamUploadToLocal(
        buffer1,
        "song.wav",
        "audio/wav",
        tempDir
      );
      const result2 = await streamUploadToLocal(
        buffer2,
        "song.wav",
        "audio/wav",
        tempDir
      );

      // Filenames should be different
      expect(result1.localPath).not.toBe(result2.localPath);

      // Both files should exist
      expect(await fs.pathExists(result1.localPath)).toBe(true);
      expect(await fs.pathExists(result2.localPath)).toBe(true);

      // Content should be different
      const content1 = await fs.readFile(result1.localPath);
      const content2 = await fs.readFile(result2.localPath);
      expect(content1).not.toEqual(content2);
    });

    it("should sanitize filename during upload", async () => {
      const buffer = Buffer.from("audio data");
      const result = await streamUploadToLocal(
        buffer,
        "my song@#$.wav",
        "audio/wav",
        tempDir
      );

      expect(result.metadata.filename).toBe("my_song.wav");
      expect(result.localPath).toContain("my_song.wav");
    });

    it("should set uploadedAt timestamp", async () => {
      const buffer = Buffer.from("audio data");
      const beforeUpload = new Date();

      const result = await streamUploadToLocal(
        buffer,
        "song.wav",
        "audio/wav",
        tempDir
      );

      const afterUpload = new Date();
      const uploadedAt = new Date(result.metadata.uploadedAt);

      expect(uploadedAt.getTime()).toBeGreaterThanOrEqual(beforeUpload.getTime());
      expect(uploadedAt.getTime()).toBeLessThanOrEqual(afterUpload.getTime());
    });
  });

  describe("deleteUploadedFile", () => {
    it("should delete uploaded file", async () => {
      const buffer = Buffer.from("audio data");
      const result = await streamUploadToLocal(
        buffer,
        "song.wav",
        "audio/wav",
        tempDir
      );

      expect(await fs.pathExists(result.localPath)).toBe(true);

      await deleteUploadedFile(result.localPath);

      expect(await fs.pathExists(result.localPath)).toBe(false);
    });

    it("should handle non-existent files gracefully", async () => {
      const nonExistentPath = path.join(tempDir, "nonexistent.wav");
      await expect(deleteUploadedFile(nonExistentPath)).resolves.not.toThrow();
    });
  });

  describe("formatFileSize", () => {
    it("should format bytes", () => {
      expect(formatFileSize(512)).toBe("512.00 B");
      expect(formatFileSize(1024)).toBe("1.00 KB");
      expect(formatFileSize(1024 * 1024)).toBe("1.00 MB");
      expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.00 GB");
    });

    it("should handle large file sizes", () => {
      const size = 200 * 1024 * 1024; // 200MB
      expect(formatFileSize(size)).toBe("200.00 MB");
    });

    it("should handle zero bytes", () => {
      expect(formatFileSize(0)).toBe("0.00 B");
    });
  });

  describe("Integration: Full upload flow", () => {
    it("should handle valid file upload end-to-end", async () => {
      // Simulate file upload
      const buffer = Buffer.from("realistic audio data");
      const filename = "My Song.wav";
      const mimeType = "audio/wav";

      // Upload
      const result = await streamUploadToLocal(buffer, filename, mimeType, tempDir);

      // Verify metadata
      expect(result.metadata.filename).toBe("My_Song.wav");
      expect(result.metadata.format).toBe("wav");
      expect(result.metadata.size).toBe(buffer.length);

      // Verify file exists
      expect(await fs.pathExists(result.localPath)).toBe(true);

      // Cleanup
      await deleteUploadedFile(result.localPath);
      expect(await fs.pathExists(result.localPath)).toBe(false);
    });

    it("should reject invalid upload with clear error", async () => {
      const buffer = Buffer.from("fake video data");
      const filename = "video.mp4";
      const mimeType = "video/mp4";

      try {
        await streamUploadToLocal(buffer, filename, mimeType, tempDir);
        expect.fail("Should have thrown FileUploadError");
      } catch (err) {
        expect(err).toBeInstanceOf(FileUploadError);
        expect((err as FileUploadError).code).toBe("INVALID_FILE_FORMAT");
        expect(err.message).toContain("Unsupported file format");
      }
    });
  });
});
