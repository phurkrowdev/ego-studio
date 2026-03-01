/**
 * Error Message Mapping
 *
 * Maps internal failure reasons to user-friendly messages.
 * Never expose stack traces or technical details to the frontend.
 */

export type FailureReason =
  | "CAPTCHA_REQUIRED"
  | "RATE_LIMITED"
  | "COPYRIGHT_RESTRICTED"
  | "DOWNLOAD_ERROR"
  | "GPU_MEMORY"
  | "INVALID_AUDIO_FORMAT"
  | "TIMEOUT"
  | "FILE_UPLOAD_ERROR"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_FORMAT"
  | "SEPARATION_FAILED"
  | "LYRICS_EXTRACTION_FAILED"
  | "AUDACITY_GENERATION_FAILED"
  | "PACKAGING_FAILED"
  | "UNKNOWN_ERROR";

export interface ErrorMessageInfo {
  userMessage: string;
  retryable: boolean;
  suggestedAction?: string;
}

/**
 * Get user-friendly error message for a failure reason
 */
export function getErrorMessage(reason: string): ErrorMessageInfo {
  const messages: Record<string, ErrorMessageInfo> = {
    CAPTCHA_REQUIRED: {
      userMessage:
        "YouTube blocked this request. Please try again later or upload the audio file directly.",
      retryable: true,
      suggestedAction: "Try again in a few minutes",
    },
    RATE_LIMITED: {
      userMessage: "Too many requests. Please wait before retrying.",
      retryable: true,
      suggestedAction: "Wait a few minutes before retrying",
    },
    COPYRIGHT_RESTRICTED: {
      userMessage:
        "This content is copyright-protected and cannot be processed. Please use your own audio.",
      retryable: false,
      suggestedAction: "Upload a different audio file",
    },
    DOWNLOAD_ERROR: {
      userMessage:
        "Failed to download audio. Please check the file and try again.",
      retryable: true,
      suggestedAction: "Try uploading a different file",
    },
    GPU_MEMORY: {
      userMessage:
        "Processing failed due to server capacity. Please try again later.",
      retryable: true,
      suggestedAction: "Try again in a few minutes",
    },
    INVALID_AUDIO_FORMAT: {
      userMessage:
        "Audio format not supported. Please use WAV, MP3, AIFF, or FLAC.",
      retryable: false,
      suggestedAction: "Convert to a supported format and try again",
    },
    TIMEOUT: {
      userMessage:
        "Processing took too long. Please try a shorter audio file.",
      retryable: true,
      suggestedAction: "Try with a shorter audio file",
    },
    FILE_UPLOAD_ERROR: {
      userMessage:
        "File upload failed. Please check the file size and format.",
      retryable: true,
      suggestedAction: "Try uploading again",
    },
    FILE_TOO_LARGE: {
      userMessage: "File is too large. Maximum size is 200MB.",
      retryable: false,
      suggestedAction: "Use a smaller audio file",
    },
    INVALID_FILE_FORMAT: {
      userMessage:
        "File format not supported. Please use WAV, MP3, AIFF, or FLAC.",
      retryable: false,
      suggestedAction: "Convert to a supported format and try again",
    },
    SEPARATION_FAILED: {
      userMessage:
        "Failed to separate audio stems. Please try with a different audio file.",
      retryable: true,
      suggestedAction: "Try again or use a different audio file",
    },
    LYRICS_EXTRACTION_FAILED: {
      userMessage:
        "Failed to extract lyrics. The ZIP will include stems and project file without lyrics.",
      retryable: false,
      suggestedAction: "Download the artifacts without lyrics",
    },
    AUDACITY_GENERATION_FAILED: {
      userMessage:
        "Failed to generate Audacity project. The ZIP will include stems and lyrics without the project file.",
      retryable: false,
      suggestedAction: "Download the artifacts without the project file",
    },
    PACKAGING_FAILED: {
      userMessage:
        "Failed to package artifacts. Please try downloading again.",
      retryable: true,
      suggestedAction: "Try downloading again",
    },
    UNKNOWN_ERROR: {
      userMessage:
        "An unexpected error occurred. Please try again or contact support.",
      retryable: true,
      suggestedAction: "Try again",
    },
  };

  return messages[reason] || messages.UNKNOWN_ERROR;
}

/**
 * Check if a failure is retryable
 */
export function isRetryable(reason: string): boolean {
  const info = getErrorMessage(reason);
  return info.retryable;
}
