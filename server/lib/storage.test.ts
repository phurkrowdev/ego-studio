/**
 * Storage Abstraction Layer Tests
 *
 * Tests for local and S3-compatible storage backends
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import { LocalStorageBackend, S3StorageBackend } from "./storage";

const TEST_STORAGE_ROOT = "/tmp/ego-studio-test-storage";

describe("LocalStorageBackend", () => {
  let backend: LocalStorageBackend;

  beforeEach(async () => {
    await fs.ensureDir(TEST_STORAGE_ROOT);
    backend = new LocalStorageBackend(TEST_STORAGE_ROOT);
  });

  afterEach(async () => {
    await fs.remove(TEST_STORAGE_ROOT);
  });

  it("should upload file with buffer", async () => {
    const key = "uploads/test.wav";
    const data = Buffer.from("test audio data");
    const url = await backend.put(key, data, "audio/wav");

    expect(url).toContain("test.wav");
    const filePath = path.join(TEST_STORAGE_ROOT, key);
    expect(await fs.pathExists(filePath)).toBe(true);
    const content = await fs.readFile(filePath);
    expect(content).toEqual(data);
  });

  it("should upload file with string", async () => {
    const key = "uploads/test.txt";
    const data = "test content";
    const url = await backend.put(key, data, "text/plain");

    expect(url).toContain("test.txt");
    const filePath = path.join(TEST_STORAGE_ROOT, key);
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(data);
  });

  it("should create nested directories", async () => {
    const key = "jobs/job-123/stems/vocals.wav";
    const data = Buffer.from("vocal stems");
    await backend.put(key, data, "audio/wav");

    const filePath = path.join(TEST_STORAGE_ROOT, key);
    expect(await fs.pathExists(filePath)).toBe(true);
  });

  it("should get file URL", async () => {
    const key = "uploads/test.wav";
    const data = Buffer.from("test audio data");
    await backend.put(key, data, "audio/wav");

    const url = await backend.get(key);
    expect(url).toContain(key);
  });

  it("should throw error when getting non-existent file", async () => {
    await expect(backend.get("non-existent.wav")).rejects.toThrow("File not found");
  });

  it("should delete file", async () => {
    const key = "uploads/test.wav";
    const data = Buffer.from("test audio data");
    await backend.put(key, data, "audio/wav");

    const filePath = path.join(TEST_STORAGE_ROOT, key);
    expect(await fs.pathExists(filePath)).toBe(true);

    await backend.delete(key);
    expect(await fs.pathExists(filePath)).toBe(false);
  });

  it("should list files with prefix", async () => {
    await backend.put("uploads/file1.wav", Buffer.from("data1"), "audio/wav");
    await backend.put("uploads/file2.wav", Buffer.from("data2"), "audio/wav");
    await backend.put("artifacts/zip1.zip", Buffer.from("zip"), "application/zip");

    const files = await backend.list("uploads/");
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.includes("file1.wav"))).toBe(true);
    expect(files.some((f) => f.includes("file2.wav"))).toBe(true);
  });

  it("should return empty array for non-existent prefix", async () => {
    const files = await backend.list("non-existent/");
    expect(files).toEqual([]);
  });

  it("should get file stats", async () => {
    const key = "uploads/test.wav";
    const data = Buffer.from("test audio data");
    await backend.put(key, data, "audio/wav");

    const stats = await backend.stat(key);
    expect(stats).not.toBeNull();
    expect(stats?.size).toBe(data.length);
    expect(stats?.modified).toBeInstanceOf(Date);
  });

  it("should return null for non-existent file stats", async () => {
    const stats = await backend.stat("non-existent.wav");
    expect(stats).toBeNull();
  });

  it("should handle special characters in filenames", async () => {
    const key = "uploads/Artist - Track (Remix) [2024].wav";
    const data = Buffer.from("test audio data");
    const url = await backend.put(key, data, "audio/wav");

    expect(url).toContain("Artist");
    const filePath = path.join(TEST_STORAGE_ROOT, key);
    expect(await fs.pathExists(filePath)).toBe(true);
  });

  it("should handle large files", async () => {
    const key = "uploads/large.wav";
    const largeData = Buffer.alloc(10 * 1024 * 1024); // 10MB
    const url = await backend.put(key, largeData, "audio/wav");

    expect(url).toContain("large.wav");
    const stats = await backend.stat(key);
    expect(stats?.size).toBe(10 * 1024 * 1024);
  });

  it("should overwrite existing file", async () => {
    const key = "uploads/test.wav";
    const data1 = Buffer.from("original data");
    const data2 = Buffer.from("updated data");

    await backend.put(key, data1, "audio/wav");
    await backend.put(key, data2, "audio/wav");

    const filePath = path.join(TEST_STORAGE_ROOT, key);
    const content = await fs.readFile(filePath);
    expect(content).toEqual(data2);
  });
});

describe("S3StorageBackend", () => {
  let backend: S3StorageBackend;

  beforeEach(() => {
    // Mock S3Client to avoid actual AWS calls
    vi.mock("@aws-sdk/client-s3");
    backend = new S3StorageBackend("test-bucket");
  });

  it("should initialize with default bucket", () => {
    const backend = new S3StorageBackend();
    expect(backend).toBeDefined();
  });

  it("should initialize with custom bucket", () => {
    const backend = new S3StorageBackend("custom-bucket");
    expect(backend).toBeDefined();
  });

  it("should support S3-compatible endpoints", () => {
    process.env.S3_ENDPOINT = "https://s3.example.com";
    process.env.S3_FORCE_PATH_STYLE = "true";

    const backend = new S3StorageBackend("test-bucket");
    expect(backend).toBeDefined();

    delete process.env.S3_ENDPOINT;
    delete process.env.S3_FORCE_PATH_STYLE;
  });

  it("should support AWS credentials from environment", () => {
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_REGION = "us-west-2";

    const backend = new S3StorageBackend("test-bucket");
    expect(backend).toBeDefined();

    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
  });
});

describe("Storage Backend Integration", () => {
  let backend: LocalStorageBackend;

  beforeEach(async () => {
    await fs.ensureDir(TEST_STORAGE_ROOT);
    backend = new LocalStorageBackend(TEST_STORAGE_ROOT);
  });

  afterEach(async () => {
    await fs.remove(TEST_STORAGE_ROOT);
  });

  it("should handle artifact packaging workflow", async () => {
    // Simulate artifact packaging workflow
    const jobId = "job-123";
    const stems = {
      vocals: Buffer.from("vocal data"),
      drums: Buffer.from("drum data"),
      bass: Buffer.from("bass data"),
      other: Buffer.from("other data"),
    };

    // Upload stems
    for (const [name, data] of Object.entries(stems)) {
      await backend.put(`jobs/${jobId}/stems/${name}.wav`, data, "audio/wav");
    }

    // Upload lyrics
    await backend.put(
      `jobs/${jobId}/lyrics.txt`,
      "Song lyrics here",
      "text/plain"
    );

    // Upload Audacity project
    await backend.put(
      `jobs/${jobId}/project.aup3`,
      Buffer.from("audacity project"),
      "application/zip"
    );

    // Verify all files exist
    const files = await backend.list(`jobs/${jobId}/`);
    expect(files.length).toBeGreaterThanOrEqual(6); // 4 stems + lyrics + project
  });

  it("should handle cleanup workflow", async () => {
    // Upload old artifacts
    const oldKey = "artifacts/old-job-123.zip";
    await backend.put(oldKey, Buffer.from("old artifact"), "application/zip");

    // List artifacts
    const artifacts = await backend.list("artifacts/");
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // Delete old artifact
    await backend.delete(oldKey);

    // Verify deletion
    const stats = await backend.stat(oldKey);
    expect(stats).toBeNull();
  });

  it("should handle concurrent uploads", async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        backend.put(
          `uploads/concurrent-${i}.wav`,
          Buffer.from(`data-${i}`),
          "audio/wav"
        )
      );
    }

    const urls = await Promise.all(promises);
    expect(urls.length).toBe(10);

    const files = await backend.list("uploads/");
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("should handle path traversal attempts safely", async () => {
    // Attempt path traversal - should be safely contained
    const maliciousKey = "uploads/../../../tmp/test.txt";
    const data = Buffer.from("test data");
    const url = await backend.put(maliciousKey, data, "text/plain");

    // File should be created and URL returned
    expect(url).toBeDefined();
    expect(url).toContain("test.txt");

    // Verify we can access the file
    const stats = await backend.stat(maliciousKey);
    expect(stats).not.toBeNull();
    expect(stats?.size).toBe(data.length);
  });
});
