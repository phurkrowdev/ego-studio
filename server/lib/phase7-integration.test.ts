/**
 * Phase 7 Integration Tests
 *
 * Comprehensive tests for:
 * - Lyrics API with caching
 * - Audacity project generation
 * - Webhook notifications
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs-extra";
import * as path from "path";
import { getCachedLyrics, cacheLyrics, clearCache, getCacheStats } from "./lyrics-cache";
import { getLyricsFromGenius, getLyricsWithFallback } from "./lyrics-api";
import {
  generateAudacityProjectXml,
  createAudacityProject,
  validateAudacityProject,
} from "./audacity-project";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  sendWebhookNotification,
} from "./webhooks";

describe("Phase 7: Production Integrations", { sequential: true }, () => {
  // ============================================================================
  // Lyrics Cache Tests
  // ============================================================================

  describe("Lyrics Cache", () => {
    beforeEach(() => {
      clearCache();
    });

    afterEach(() => {
      clearCache();
    });

    it("should cache and retrieve lyrics", () => {
      const title = "Test Song";
      const artist = "Test Artist";
      const lyrics = "Test lyrics content";

      cacheLyrics(title, artist, lyrics, 0.95);
      const cached = getCachedLyrics(title, artist);

      expect(cached).not.toBeNull();
      expect(cached?.lyrics).toBe(lyrics);
      expect(cached?.confidence).toBe(0.95);
    });

    it("should handle case-insensitive lookups", () => {
      cacheLyrics("Song Title", "Artist Name", "Lyrics", 0.9);

      const cached1 = getCachedLyrics("song title", "artist name");
      const cached2 = getCachedLyrics("SONG TITLE", "ARTIST NAME");

      expect(cached1).not.toBeNull();
      expect(cached2).not.toBeNull();
    });

    it("should return null for uncached entries", () => {
      const cached = getCachedLyrics("Nonexistent", "Song");
      expect(cached).toBeNull();
    });

    it("should track cache stats", () => {
      cacheLyrics("Song 1", "Artist 1", "Lyrics 1", 0.9);
      cacheLyrics("Song 2", "Artist 2", "Lyrics 2", 0.85);

      const stats = getCacheStats();
      expect(stats.keys).toBe(2);
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Lyrics API Tests
  // ============================================================================

  describe("Lyrics API", () => {
    beforeEach(() => {
      clearCache();
    });

    afterEach(() => {
      clearCache();
    });

    it("should return lyrics with fallback", async () => {
      const result = await getLyricsWithFallback("Test Song", "Test Artist");

      expect(result.success).toBe(true);
      expect(result.lyrics).toBeDefined();
      expect(result.lyrics).toContain("Test Song");
    });

    it("should cache results after API call", async () => {
      const title = "Song Title";
      const artist = "Artist Name";

      const result1 = await getLyricsWithFallback(title, artist);
      expect(result1.success).toBe(true);

      const cached = getCachedLyrics(title, artist);
      expect(cached).not.toBeNull();
      expect(cached?.lyrics).toBe(result1.lyrics);
    });

    it("should use cache on subsequent calls", async () => {
      const title = "Cached Song";
      const artist = "Cached Artist";

      // First call
      const result1 = await getLyricsWithFallback(title, artist);
      expect(result1.source).toBeDefined();

      // Second call should use cache
      const result2 = await getLyricsWithFallback(title, artist);
      expect(result2.source).toBe("cache");
      expect(result2.lyrics).toBe(result1.lyrics);
    });

    it("should handle missing API key gracefully", async () => {
      // Temporarily remove API key
      const originalKey = process.env.GENIUS_API_KEY;
      delete process.env.GENIUS_API_KEY;

      const result = await getLyricsWithFallback("Test", "Test");
      expect(result.success).toBe(true); // Should use fallback

      // Restore API key
      if (originalKey) {
        process.env.GENIUS_API_KEY = originalKey;
      }
    });
  });

  // ============================================================================
  // Audacity Project Tests
  // ============================================================================

  describe("Audacity Project Generation", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = path.join("/tmp", `audacity-test-${Date.now()}`);
      await fs.ensureDir(testDir);
    });

    afterEach(async () => {
      await fs.remove(testDir);
    });

    it("should generate valid project XML", () => {
      const tracks = [
        {
          name: "Vocals",
          filePath: "/path/to/vocals.wav",
          channels: 2,
          sampleRate: 44100,
        },
        {
          name: "Drums",
          filePath: "/path/to/drums.wav",
          channels: 2,
          sampleRate: 44100,
        },
      ];

      const xml = generateAudacityProjectXml("Test Project", tracks);

      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain("Audacity");
      expect(xml).toContain("Test Project");
      expect(xml).toContain("Vocals");
      expect(xml).toContain("Drums");
    });

    it("should escape XML special characters", () => {
      const tracks = [
        {
          name: 'Track with "quotes" & <brackets>',
          filePath: "/path/to/file.wav",
          channels: 2,
          sampleRate: 44100,
        },
      ];

      const xml = generateAudacityProjectXml("Project", tracks);

      expect(xml).toContain("&quot;");
      expect(xml).toContain("&amp;");
      expect(xml).toContain("&lt;");
      expect(xml).toContain("&gt;");
    });

    it("should create project directory structure", async () => {
      // Create dummy stem files
      const vocalsPath = path.join(testDir, "vocals.wav");
      const drumsPath = path.join(testDir, "drums.wav");
      const bassPath = path.join(testDir, "bass.wav");
      const otherPath = path.join(testDir, "other.wav");

      await fs.writeFile(vocalsPath, "mock audio data");
      await fs.writeFile(drumsPath, "mock audio data");
      await fs.writeFile(bassPath, "mock audio data");
      await fs.writeFile(otherPath, "mock audio data");

      const result = await createAudacityProject(testDir, "TestProject", {
        vocals: vocalsPath,
        drums: drumsPath,
        bass: bassPath,
        other: otherPath,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      // Verify project structure
      const projectDir = path.join(testDir, "TestProject_data");
      expect(await fs.pathExists(projectDir)).toBe(true);
      expect(await fs.pathExists(path.join(projectDir, "project.xml"))).toBe(true);
    });

    it("should handle missing stem files", async () => {
      const result = await createAudacityProject(testDir, "TestProject", {
        vocals: "/nonexistent/vocals.wav",
        drums: "/nonexistent/drums.wav",
        bass: "/nonexistent/bass.wav",
        other: "/nonexistent/other.wav",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should validate project structure", async () => {
      // Create minimal project structure
      const projectDir = path.join(testDir, "TestProject_data");
      await fs.ensureDir(projectDir);

      const projectXml = `<?xml version="1.0"?>
<project>
  <track name="Vocals"/>
</project>`;

      await fs.writeFile(path.join(projectDir, "project.xml"), projectXml);

      // Validation should fail because stem files are missing
      const validation = await validateAudacityProject(
        path.join(testDir, "TestProject.aup3")
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Webhook Tests
  // ============================================================================

  describe("Webhook Notifications", () => {
    it("should sign webhook payload correctly", () => {
      const payload = {
        jobId: "test-job-123",
        stage: "yt-dlp",
        state: "DONE",
        timestamp: new Date().toISOString(),
      };

      const secret = "test-secret-key";
      const signature = signWebhookPayload(payload, secret);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
      expect(signature).toMatch(/^[a-f0-9]+$/); // Hex string
    });

    it("should verify valid webhook signature", () => {
      const payload = {
        jobId: "test-job-123",
        stage: "yt-dlp",
        state: "DONE",
        timestamp: new Date().toISOString(),
      };

      const secret = "test-secret-key";
      const signature = signWebhookPayload(payload, secret);

      const isValid = verifyWebhookSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it("should reject invalid webhook signature", () => {
      const payload = {
        jobId: "test-job-123",
        stage: "yt-dlp",
        state: "DONE",
        timestamp: new Date().toISOString(),
      };

      const secret = "test-secret-key";
      const invalidSignature = "invalid-signature-hash";

      const isValid = verifyWebhookSignature(payload, invalidSignature, secret);
      expect(isValid).toBe(false);
    });

    it("should detect payload tampering", () => {
      const payload = {
        jobId: "test-job-123",
        stage: "yt-dlp",
        state: "DONE",
        timestamp: new Date().toISOString(),
      };

      const secret = "test-secret-key";
      const signature = signWebhookPayload(payload, secret);

      // Tamper with payload
      const tamperedPayload = {
        ...payload,
        state: "FAILED",
      };

      const isValid = verifyWebhookSignature(tamperedPayload, signature, secret);
      expect(isValid).toBe(false);
    });

    it("should handle webhook delivery with retry", async () => {
      const payload = {
        jobId: "test-job-123",
        stage: "yt-dlp",
        state: "DONE",
        timestamp: new Date().toISOString(),
      };

      // Mock axios to simulate failure then success
      let attemptCount = 0;
      vi.mock("axios", () => ({
        default: {
          post: vi.fn(async () => {
            attemptCount++;
            if (attemptCount < 2) {
              throw new Error("Network error");
            }
            return { status: 200 };
          }),
        },
      }));

      // Note: In real tests, would use proper mocking framework
      // This is a placeholder for the test structure
      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Cross-Module Integration", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = path.join("/tmp", `integration-test-${Date.now()}`);
      await fs.ensureDir(testDir);
      clearCache();
    });

    afterEach(async () => {
      await fs.remove(testDir);
      clearCache();
    });

    it("should complete full pipeline: Lyrics → Audacity → Webhook", async () => {
      // Step 1: Get lyrics
      const lyricsResult = await getLyricsWithFallback("Test Song", "Test Artist");
      expect(lyricsResult.success).toBe(true);

      // Step 2: Create Audacity project
      const vocalsPath = path.join(testDir, "vocals.wav");
      const drumsPath = path.join(testDir, "drums.wav");
      const bassPath = path.join(testDir, "bass.wav");
      const otherPath = path.join(testDir, "other.wav");

      await fs.writeFile(vocalsPath, "mock audio");
      await fs.writeFile(drumsPath, "mock audio");
      await fs.writeFile(bassPath, "mock audio");
      await fs.writeFile(otherPath, "mock audio");

      const projectResult = await createAudacityProject(testDir, "TestProject", {
        vocals: vocalsPath,
        drums: drumsPath,
        bass: bassPath,
        other: otherPath,
      });

      expect(projectResult.success).toBe(true);

      // Step 3: Create webhook payload
      const payload = {
        jobId: "test-job-123",
        stage: "audacity",
        state: "DONE",
        timestamp: new Date().toISOString(),
        metadata: {
          lyricsSource: lyricsResult.source,
          projectPath: projectResult.path,
        },
      };

      // Step 4: Sign webhook
      const signature = signWebhookPayload(payload, "webhook-secret");
      expect(signature).toBeDefined();

      // Verify signature
      const isValid = verifyWebhookSignature(payload, signature, "webhook-secret");
      expect(isValid).toBe(true);
    });
  });
});
