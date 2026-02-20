/**
 * HTTP Upload Endpoint
 *
 * Dedicated POST /api/upload endpoint for file uploads.
 * Uses busboy for streaming file handling.
 * Validates MIME type and file size.
 * Calls createJobFromFile() to create job.
 *
 * Architectural principle:
 * - File upload is a transport concern (HTTP endpoint)
 * - Job creation is orchestration (tRPC layer)
 * - Separation of concerns preserved
 */

import { Express, Request, Response } from "express";
import Busboy from "busboy";
import path from "path";
import { createJobFromFile } from "../lib/jobs-service-file";
import { UPLOAD_CONSTRAINTS, SUPPORTED_FORMATS } from "../lib/file-upload";

/**
 * Register upload endpoint
 */
export function registerUploadRoutes(app: Express): void {
  app.post("/api/upload", handleFileUpload);
}

/**
 * Handle file upload request
 *
 * Expected multipart/form-data with single file field "file"
 * Response: { jobId: string, metadata: JobResponse["metadata"] }
 */
async function handleFileUpload(req: Request, res: Response): Promise<void> {
  try {
    // Validate content type
    if (!req.is("multipart/form-data")) {
      res.status(400).json({
        error: "Invalid content type. Expected multipart/form-data.",
      });
      return;
    }

    // Parse multipart form data with busboy
    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: UPLOAD_CONSTRAINTS.maxFileSize,
        files: 1, // Only one file allowed
      },
    });

    let fileBuffer: Buffer | null = null;
    let filename: string | null = null;
    let mimeType: string | null = null;
    let uploadError: Error | null = null;
    let fileSizeExceeded = false;

    // Handle file stream
    bb.on("file", (fieldname: string, file: NodeJS.ReadableStream, info: any) => {
      // Only accept "file" field
      if (fieldname !== "file") {
        file.resume(); // Drain stream
        return;
      }

      filename = info.filename;
      mimeType = info.mimeType;

      const chunks: Buffer[] = [];

      file.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });

      file.on("error", (err: Error) => {
        uploadError = err;
      });
    });

    // Handle form errors
    bb.on("error", (err: Error) => {
      uploadError = err;
    });

    // Handle file size limit exceeded
    bb.on("filesLimit", () => {
      fileSizeExceeded = true;
    });

    // Wait for busboy to finish parsing
    await new Promise<void>((resolve, reject) => {
      bb.on("finish", () => {
        if (fileSizeExceeded) {
          reject(new Error("File is too large. Maximum size is 200MB."));
        } else if (uploadError) {
          reject(uploadError);
        } else {
          resolve();
        }
      });

      bb.on("error", reject);

      // Pipe request to busboy
      req.pipe(bb);
    });

    // Validate file was uploaded
    if (!fileBuffer || !filename || !mimeType) {
      res.status(400).json({
        error: "No file provided. Please upload an audio file.",
      });
      return;
    }

    // Validate file size
    if ((fileBuffer as Buffer).length > UPLOAD_CONSTRAINTS.maxFileSize) {
      res.status(413).json({
        error: `File is too large. Maximum size is 200MB.`,
      });
      return;
    }

    if ((fileBuffer as Buffer).length === 0) {
      res.status(400).json({
        error: "File is empty. Please upload a valid audio file.",
      });
      return;
    }

    // Validate MIME type
    if (!UPLOAD_CONSTRAINTS.supportedMimeTypes.includes(mimeType)) {
      res.status(415).json({
        error: `Unsupported file format. Supported formats: WAV, MP3, AIFF, FLAC.`,
      });
      return;
    }

    // Create job from file
    const jobResponse = await createJobFromFile(
      fileBuffer as Buffer,
      filename as string,
      mimeType as string
    );

    console.log(
      `[Upload] Successfully created job ${jobResponse.jobId} for file ${filename}`
    );

    // Return job response
    res.status(201).json({
      jobId: jobResponse.jobId,
      metadata: jobResponse.metadata,
    });
  } catch (err: unknown) {
    console.error(`[Upload] Error handling file upload:`, err);

    // Check if response already sent
    if (res.headersSent) {
      return;
    }

    // Return error response
    const errorMessage =
      err instanceof Error
        ? err.message
        : "Failed to upload file. Please try again.";

    res.status(500).json({
      error: errorMessage,
    });
  }
}


