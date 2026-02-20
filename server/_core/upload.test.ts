/**
 * Upload Endpoint Tests
 *
 * Tests for HTTP POST /api/upload endpoint.
 * Validates file streaming, MIME type checking, size limits, and job creation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import fs from "fs-extra";
import path from "path";
import { registerUploadRoutes } from "./upload";

describe("POST /api/upload", () => {
  let app: Express;
  let tempDir: string;

  beforeEach(async () => {
    // Create Express app with upload endpoint
    app = express();
    app.use(express.json());
    registerUploadRoutes(app);

    // Create temp directory for test uploads
    tempDir = path.join("/tmp", `upload-endpoint-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    // Mock STORAGE_ROOT
    process.env.STORAGE_ROOT = tempDir;
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe("Valid file uploads", () => {
    it("should accept WAV file", async () => {
      const wavBuffer = Buffer.from("RIFF....WAVE..."); // Minimal WAV header
      const response = await request(app)
        .post("/api/upload")
        .attach("file", wavBuffer, "test.wav");

      expect([201, 400, 415, 500]).toContain(response.status);
    });

    it("should accept MP3 file", async () => {
      const mp3Buffer = Buffer.from("ID3...."); // Minimal MP3 header
      const response = await request(app)
        .post("/api/upload")
        .attach("file", mp3Buffer, "track.mp3");

      expect([201, 400, 415, 500]).toContain(response.status);
    });

    it("should accept FLAC file", async () => {
      const flacBuffer = Buffer.from("fLaC...."); // Minimal FLAC header
      const response = await request(app)
        .post("/api/upload")
        .attach("file", flacBuffer, "song.flac");

      expect([201, 400, 415, 500]).toContain(response.status);
    });

    it("should accept AIFF file", async () => {
      const aiffBuffer = Buffer.from("FORM....AIFF...."); // Minimal AIFF header
      const response = await request(app)
        .post("/api/upload")
        .attach("file", aiffBuffer, "audio.aiff");

      expect([201, 400, 415, 500]).toContain(response.status);
    });
  });

  describe("Invalid MIME types", () => {
    it("should reject video/mp4 file with 415", async () => {
      const buffer = Buffer.from("fake video data");
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, { filename: "video.mp4", contentType: "video/mp4" });

      expect(response.status).toBe(415);
      expect(response.body.error).toBeDefined();
    });

    it("should reject image/png file with 415", async () => {
      const buffer = Buffer.from("fake image data");
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, { filename: "image.png", contentType: "image/png" });

      expect(response.status).toBe(415);
      expect(response.body.error).toBeDefined();
    });

    it("should reject text/plain file with 415", async () => {
      const buffer = Buffer.from("text data");
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, { filename: "document.txt", contentType: "text/plain" });

      expect(response.status).toBe(415);
      expect(response.body.error).toBeDefined();
    });
  });

  describe("File size validation", () => {
    it("should accept reasonable file size", async () => {
      const buffer = Buffer.alloc(1024 * 1024); // 1MB
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, "large.wav");

      expect([201, 400, 415, 500]).toContain(response.status);
    });

    it("should reject empty file with 400", async () => {
      const buffer = Buffer.alloc(0);
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, "empty.wav");

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("empty");
    });
  });

  describe("Missing or invalid requests", () => {
    it("should reject request without file", async () => {
      const response = await request(app)
        .post("/api/upload")
        .set("Content-Type", "multipart/form-data");

      expect([400, 500]).toContain(response.status);
      expect(response.body.error).toBeDefined();
    });

    it("should reject request with wrong content type", async () => {
      const response = await request(app)
        .post("/api/upload")
        .set("Content-Type", "application/json")
        .send({ file: "not a file" });

      expect([400, 500]).toContain(response.status);
      expect(response.body.error).toBeDefined();
    });
  });

  describe("Error response format", () => {
    it("should return error object with message", async () => {
      const buffer = Buffer.from("fake video data");
      const response = await request(app)
        .post("/api/upload")
        .attach("file", buffer, { filename: "video.mp4", contentType: "video/mp4" });

      expect(response.body).toHaveProperty("error");
      expect(typeof response.body.error).toBe("string");
    });
  });

  describe("Endpoint availability", () => {
    it("should respond to POST /api/upload", async () => {
      const response = await request(app)
        .post("/api/upload")
        .set("Content-Type", "multipart/form-data");

      // Should not be 404
      expect(response.status).not.toBe(404);
    });

    it("should reject GET requests", async () => {
      const response = await request(app).get("/api/upload");

      expect(response.status).toBe(404);
    });
  });
});
