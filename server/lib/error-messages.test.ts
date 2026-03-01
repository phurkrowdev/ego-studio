import { describe, it, expect } from "vitest";
import { getErrorMessage, isRetryable } from "./error-messages";

describe("Error Messages", () => {
  describe("getErrorMessage", () => {
    it("should return user-friendly message for CAPTCHA_REQUIRED", () => {
      const msg = getErrorMessage("CAPTCHA_REQUIRED");
      expect(msg.userMessage).toContain("YouTube blocked");
      expect(msg.retryable).toBe(true);
      expect(msg.userMessage).not.toContain("stack");
      expect(msg.userMessage).not.toContain("Error:");
    });

    it("should return user-friendly message for FILE_TOO_LARGE", () => {
      const msg = getErrorMessage("FILE_TOO_LARGE");
      expect(msg.userMessage).toContain("200MB");
      expect(msg.retryable).toBe(false);
    });

    it("should return user-friendly message for GPU_MEMORY", () => {
      const msg = getErrorMessage("GPU_MEMORY");
      expect(msg.userMessage).toContain("server capacity");
      expect(msg.retryable).toBe(true);
    });

    it("should return user-friendly message for INVALID_AUDIO_FORMAT", () => {
      const msg = getErrorMessage("INVALID_AUDIO_FORMAT");
      expect(msg.userMessage).toContain("WAV, MP3, AIFF, or FLAC");
      expect(msg.retryable).toBe(false);
    });

    it("should return default message for unknown error", () => {
      const msg = getErrorMessage("UNKNOWN_REASON");
      expect(msg.userMessage).toContain("unexpected error");
      expect(msg.retryable).toBe(true);
    });

    it("should never expose stack traces", () => {
      const reasons = [
        "CAPTCHA_REQUIRED",
        "RATE_LIMITED",
        "COPYRIGHT_RESTRICTED",
        "DOWNLOAD_ERROR",
        "GPU_MEMORY",
        "INVALID_AUDIO_FORMAT",
        "TIMEOUT",
        "FILE_UPLOAD_ERROR",
        "FILE_TOO_LARGE",
        "INVALID_FILE_FORMAT",
        "SEPARATION_FAILED",
        "LYRICS_EXTRACTION_FAILED",
        "AUDACITY_GENERATION_FAILED",
        "PACKAGING_FAILED",
      ];

      for (const reason of reasons) {
        const msg = getErrorMessage(reason);
        expect(msg.userMessage).not.toContain("stack");
        expect(msg.userMessage).not.toContain(".js:");
      }
    });

    it("should include suggested action for retryable errors", () => {
      const msg = getErrorMessage("RATE_LIMITED");
      expect(msg.suggestedAction).toBeDefined();
      expect(msg.suggestedAction).toBeTruthy();
    });
  });

  describe("isRetryable", () => {
    it("should return true for retryable errors", () => {
      expect(isRetryable("CAPTCHA_REQUIRED")).toBe(true);
      expect(isRetryable("RATE_LIMITED")).toBe(true);
      expect(isRetryable("TIMEOUT")).toBe(true);
      expect(isRetryable("GPU_MEMORY")).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      expect(isRetryable("FILE_TOO_LARGE")).toBe(false);
      expect(isRetryable("COPYRIGHT_RESTRICTED")).toBe(false);
      expect(isRetryable("INVALID_AUDIO_FORMAT")).toBe(false);
      expect(isRetryable("INVALID_FILE_FORMAT")).toBe(false);
    });

    it("should return true for unknown errors (safe default)", () => {
      expect(isRetryable("UNKNOWN_REASON")).toBe(true);
    });
  });
});
