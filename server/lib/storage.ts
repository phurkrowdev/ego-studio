/**
 * Storage Abstraction Layer
 *
 * Unified interface for file storage supporting multiple backends:
 * - Local filesystem (development, testing)
 * - AWS S3 (production)
 * - Backblaze B2 (S3-compatible, cost-effective)
 * - Minio (self-hosted S3-compatible)
 *
 * Environment Variables:
 * - STORAGE_TYPE: 'local' | 's3' (default: 'local')
 * - STORAGE_ROOT: Local filesystem root (default: /tmp/ego-studio-jobs)
 * - AWS_REGION: AWS region (default: us-east-1)
 * - AWS_ACCESS_KEY_ID: AWS credentials
 * - AWS_SECRET_ACCESS_KEY: AWS credentials
 * - S3_BUCKET: S3 bucket name
 * - S3_ENDPOINT: S3-compatible endpoint (for B2, Minio)
 * - S3_FORCE_PATH_STYLE: true for Minio/B2 (default: false for AWS)
 */

import fs from "fs-extra";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Storage backend interface
 */
export interface StorageBackend {
  /**
   * Upload file to storage
   * @param key Unique file key (e.g., 'uploads/job-123/audio.wav')
   * @param data File content (Buffer or string)
   * @param contentType MIME type (e.g., 'audio/wav')
   * @returns URL to access the file
   */
  put(key: string, data: Buffer | string, contentType: string): Promise<string>;

  /**
   * Get file from storage
   * @param key File key
   * @param expiresIn Expiration time in seconds (for presigned URLs)
   * @returns URL to access the file (may be presigned for S3)
   */
  get(key: string, expiresIn?: number): Promise<string>;

  /**
   * Delete file from storage
   * @param key File key
   */
  delete(key: string): Promise<void>;

  /**
   * List files in storage with prefix
   * @param prefix Directory prefix (e.g., 'artifacts/')
   * @returns Array of file keys
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Get file stats (size, modified time)
   * @param key File key
   * @returns File metadata or null if not found
   */
  stat(key: string): Promise<{ size: number; modified: Date } | null>;
}

/**
 * Local filesystem storage backend
 */
export class LocalStorageBackend implements StorageBackend {
  private root: string;

  constructor(root: string = process.env.STORAGE_ROOT || "/tmp/ego-studio-jobs") {
    this.root = root;
  }

  async put(key: string, data: Buffer | string, _contentType: string): Promise<string> {
    const filePath = path.join(this.root, key);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, data);
    return `/storage/${key}`; // Local URL
  }

  async get(key: string, _expiresIn?: number): Promise<string> {
    const filePath = path.join(this.root, key);
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`File not found: ${key}`);
    }
    return `/storage/${key}`; // Local URL
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.root, key);
    await fs.remove(filePath);
  }

  async list(prefix: string): Promise<string[]> {
    const dirPath = path.join(this.root, prefix);
    if (!(await fs.pathExists(dirPath))) {
      return [];
    }
    const files = await fs.readdir(dirPath, { recursive: true });
    return files
      .filter((f) => typeof f === "string")
      .map((f) => path.join(prefix, f as string));
  }

  async stat(key: string): Promise<{ size: number; modified: Date } | null> {
    const filePath = path.join(this.root, key);
    try {
      const stat = await fs.stat(filePath);
      return {
        size: stat.size,
        modified: stat.mtime,
      };
    } catch {
      return null;
    }
  }
}

/**
 * S3-compatible storage backend (AWS S3, Backblaze B2, Minio)
 */
export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string = process.env.S3_BUCKET || "ego-studio-audio") {
    this.bucket = bucket;

    const config: any = {
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    };

    // Support S3-compatible endpoints (Backblaze B2, Minio)
    if (process.env.S3_ENDPOINT) {
      config.endpoint = process.env.S3_ENDPOINT;
      config.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";
    }

    this.client = new S3Client(config);
  }

  async put(key: string, data: Buffer | string, contentType: string): Promise<string> {
    const buffer = typeof data === "string" ? Buffer.from(data) : data;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    // Return public URL (adjust based on your S3 setup)
    if (process.env.S3_ENDPOINT) {
      // S3-compatible endpoint
      return `${process.env.S3_ENDPOINT}/${this.bucket}/${key}`;
    }
    // AWS S3
    return `https://${this.bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${key}`;
  }

  async get(key: string, expiresIn: number = 3600): Promise<string> {
    // Generate presigned URL for secure access
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async list(prefix: string): Promise<string[]> {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    return (result.Contents || []).map((obj) => obj.Key || "");
  }

  async stat(key: string): Promise<{ size: number; modified: Date } | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return {
        size: result.ContentLength || 0,
        modified: result.LastModified || new Date(),
      };
    } catch {
      return null;
    }
  }
}

/**
 * Storage factory - returns appropriate backend based on environment
 */
export function createStorageBackend(): StorageBackend {
  const storageType = process.env.STORAGE_TYPE || "local";

  if (storageType === "s3") {
    return new S3StorageBackend();
  }

  return new LocalStorageBackend();
}

/**
 * Global storage instance
 */
let storage: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (!storage) {
    storage = createStorageBackend();
  }
  return storage;
}

/**
 * Helper functions for common operations
 */

/**
 * Upload file to storage
 * @param key File key (e.g., 'uploads/job-123/audio.wav')
 * @param data File content
 * @param contentType MIME type
 * @returns URL to access the file
 */
export async function storagePut(
  key: string,
  data: Buffer | string,
  contentType: string
): Promise<string> {
  return getStorage().put(key, data, contentType);
}

/**
 * Get file URL from storage (may be presigned for S3)
 * @param key File key
 * @param expiresIn Expiration time in seconds (for S3 presigned URLs)
 * @returns URL to access the file
 */
export async function storageGet(key: string, expiresIn?: number): Promise<string> {
  return getStorage().get(key, expiresIn);
}

/**
 * Delete file from storage
 * @param key File key
 */
export async function storageDelete(key: string): Promise<void> {
  return getStorage().delete(key);
}

/**
 * List files in storage with prefix
 * @param prefix Directory prefix
 * @returns Array of file keys
 */
export async function storageList(prefix: string): Promise<string[]> {
  return getStorage().list(prefix);
}

/**
 * Get file stats
 * @param key File key
 * @returns File metadata or null if not found
 */
export async function storageStat(
  key: string
): Promise<{ size: number; modified: Date } | null> {
  return getStorage().stat(key);
}
