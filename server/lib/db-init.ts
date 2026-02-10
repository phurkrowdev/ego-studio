/**
 * Database Initialization from Filesystem
 *
 * On startup, rebuild the database from filesystem truth.
 * This ensures database is always consistent with filesystem.
 *
 * Invariants:
 * - Database is derived index only, never authoritative
 * - Filesystem is source of truth
 * - On startup, database is wiped and rebuilt
 * - Job exists because folder exists
 */

import { listAllJobs } from "./filesystem";
import { getDb } from "../db";
import { jobs as jobsTable } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Rebuild database from filesystem
 */
export async function initializeDatabaseFromFilesystem(): Promise<void> {
  console.log("[db-init] Starting database initialization from filesystem...");

  try {
    const db = await getDb();
    if (!db) {
      console.warn("[db-init] Database not available, skipping initialization");
      return;
    }

    // Clear existing jobs table
    await db.delete(jobsTable);
    console.log("[db-init] Cleared jobs table");

    // List all jobs from filesystem
    const allJobs = await listAllJobs();
    console.log(`[db-init] Found ${allJobs.length} jobs in filesystem`);

    // Insert jobs into database
    for (const { jobId, state, metadata } of allJobs) {
      await db.insert(jobsTable).values({
        jobId,
        state,
        metadata: JSON.stringify(metadata),
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
        ownerId: metadata.ownerId,
        leaseExpiresAt: metadata.leaseExpiresAt ? new Date(metadata.leaseExpiresAt) : null,
      });
    }

    console.log(`[db-init] Inserted ${allJobs.length} jobs into database`);
    console.log("[db-init] Database initialization complete");
  } catch (error) {
    console.error("[db-init] Error initializing database:", error);
    // Don't throw — database initialization is optional
  }
}

/**
 * Sync a single job to database (after filesystem operation)
 */
export async function syncJobToDatabase(jobId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[db-init] Database not available, skipping sync");
    return;
  }

  const allJobs = await listAllJobs();
  const job = allJobs.find((j) => j.jobId === jobId);

  if (!job) {
    // Job deleted, remove from database
    await db.delete(jobsTable).where(eq(jobsTable.jobId, jobId));
    return;
  }

  // Upsert job
  const { metadata, state } = job;

  // Check if exists
    const queryDb = await getDb();
    if (!queryDb) return;
    const existing = await queryDb.select().from(jobsTable).where(eq(jobsTable.jobId, jobId)).limit(1);

  if (existing && existing.length > 0) {
    // Update
    await db
      .update(jobsTable)
      .set({
        state,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date(metadata.updatedAt),
        ownerId: metadata.ownerId,
        leaseExpiresAt: metadata.leaseExpiresAt ? new Date(metadata.leaseExpiresAt) : null,
      })
      .where(eq(jobsTable.jobId, jobId));
  } else {
    // Insert
    const insertDb = await getDb();
    if (!insertDb) return;
    await insertDb.insert(jobsTable).values({
      jobId,
      state,
      metadata: JSON.stringify(metadata),
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
      ownerId: metadata.ownerId,
      leaseExpiresAt: metadata.leaseExpiresAt ? new Date(metadata.leaseExpiresAt) : null,
    });
  }
}


