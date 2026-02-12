/**
 * Webhook Notification System
 *
 * Sends webhook notifications on job stage completion or failure.
 * Implements secure payload signing and retry logic.
 */

import axios from "axios";
import crypto from "crypto";

interface WebhookPayload {
  jobId: string;
  stage: string;
  state: string;
  timestamp: string;
  metadata?: Record<string, any>;
  failureReason?: string;
}

interface WebhookConfig {
  url: string;
  secret: string;
  retryCount?: number;
  retryDelay?: number;
}

/**
 * Sign webhook payload with HMAC-SHA256
 */
export function signWebhookPayload(
  payload: WebhookPayload,
  secret: string
): string {
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(payloadString)
    .digest("hex");
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: WebhookPayload,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = signWebhookPayload(payload, secret);
  // Handle different buffer lengths by comparing strings instead
  return signature === expectedSignature;
}

/**
 * Send webhook notification with retry logic
 */
export async function sendWebhookNotification(
  config: WebhookConfig,
  payload: WebhookPayload,
  retryCount: number = 0
): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
  retries?: number;
}> {
  const maxRetries = config.retryCount || 3;
  const retryDelay = config.retryDelay || 1000;

  try {
    // Sign payload
    const signature = signWebhookPayload(payload, config.secret);

    // Send webhook
    const response = await axios.post(config.url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": payload.timestamp,
      },
      timeout: 10000,
    });

    return {
      success: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      retries: retryCount,
    };
  } catch (error) {
    // Retry on failure (exponential backoff)
    if (retryCount < maxRetries) {
      const delay = retryDelay * Math.pow(2, retryCount);
      console.warn(
        `[webhooks] Webhook delivery failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendWebhookNotification(config, payload, retryCount + 1);
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Webhook delivery failed after ${maxRetries} retries: ${message}`,
      retries: retryCount,
    };
  }
}

/**
 * Notify webhook on job completion
 */
export async function notifyJobCompletion(
  webhookUrl: string,
  webhookSecret: string,
  jobId: string,
  stage: string,
  metadata?: Record<string, any>
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const payload: WebhookPayload = {
      jobId,
      stage,
      state: "DONE",
      timestamp: new Date().toISOString(),
      metadata,
    };

    const result = await sendWebhookNotification(
      {
        url: webhookUrl,
        secret: webhookSecret,
      },
      payload
    );

    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to notify webhook: ${message}`,
    };
  }
}

/**
 * Notify webhook on job failure
 */
export async function notifyJobFailure(
  webhookUrl: string,
  webhookSecret: string,
  jobId: string,
  stage: string,
  failureReason: string,
  metadata?: Record<string, any>
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const payload: WebhookPayload = {
      jobId,
      stage,
      state: "FAILED",
      timestamp: new Date().toISOString(),
      failureReason,
      metadata,
    };

    const result = await sendWebhookNotification(
      {
        url: webhookUrl,
        secret: webhookSecret,
      },
      payload
    );

    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to notify webhook: ${message}`,
    };
  }
}
