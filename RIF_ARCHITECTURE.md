# Reusable Ingestion Framework (RIF) — Architecture

## Overview

E.G.O. Studio Audio is built on **RIF**, a deterministic job orchestration framework designed for long-running, fault-tolerant ingestion pipelines. The framework separates concerns into three layers:

1. **rif-core** — Job state machine, filesystem authority, atomic transitions
2. **rif-adapters** — Pluggable workers (download, separation, feature extraction)
3. **rif-api** — Thin HTTP/tRPC surface exposing filesystem truth

This document defines the framework guarantees, invariants, and constraints for building new adapters.

---

## Architecture Layers

### rif-core: Job Orchestration Engine

**Responsibility:** Manage job lifecycle, enforce state ownership, maintain filesystem authority.

**Core Modules:**

| Module | Purpose |
|--------|---------|
| `server/lib/filesystem.ts` | State directories, metadata I/O, job folder structure |
| `server/lib/job-state.ts` | State enum, transition validation, actor enforcement |
| `server/lib/job-moves.ts` | Atomic directory moves (race-safe state transitions) |
| `server/lib/db-init.ts` | Database rebuild from filesystem on startup |

**Guarantees:**

1. **Filesystem Authority** — Job state is encoded by directory location (`NEW/`, `CLAIMED/`, `RUNNING/`, `DONE/`, `FAILED/`)
2. **State Ownership** — Only authorized actors can transition states they own
3. **Atomicity** — State transitions via `fs.rename()` are atomic on same filesystem
4. **Idempotency** — Workers can be killed/restarted without data loss
5. **Restart-Safety** — On startup, database is rebuilt from filesystem truth
6. **Observability** — All state transitions logged with timestamps and actor identity

**Invariants (Non-Negotiable):**

- No database writes without prior filesystem validation
- No inferred state (state is explicit, never derived from timestamps)
- No auto-correction of invalid states
- Database is a derived index only; never authoritative
- Job exists because folder exists, not vice versa

---

### rif-adapters: Pluggable Workers

**Responsibility:** Process jobs in specific states, write artifacts, update metadata, transition to next state.

**Adapter Lifecycle:**

```
Input: jobId
├─ Read job metadata from filesystem
├─ Verify job is in expected state
├─ Perform work (download, process, extract)
├─ Write artifacts to job folder
├─ Update metadata with results
└─ Transition to next state (if applicable)
```

**Adapter Categories:**

| Category | Responsibility | State Transitions | Examples |
|----------|-----------------|-------------------|----------|
| **Lifecycle Adapters** | Advance job through core states | Own state transitions | Download (CLAIMED→RUNNING→DONE/FAILED) |
| **Feature Adapters** | Add metadata/artifacts without state change | No state transitions | Lyrics lookup, Audacity session generation |
| **Utility Adapters** | Inspect, repair, or reclaim jobs | System-owned transitions | Lease expiry reclaim (CLAIMED/RUNNING→NEW) |

**Reference Adapter: yt-dlp Download Worker**

**Location:** `server/workers/ytdlp-worker.ts`

**Responsibility:** Download audio from YouTube, classify failures, write manifest.

**Behavior:**

1. Reads job metadata from `CLAIMED/{jobId}/metadata.json`
2. Transitions to `RUNNING/{jobId}/` (state ownership: DOWNLOAD_WORKER)
3. Executes yt-dlp subprocess, captures stderr/stdout
4. On success:
   - Writes audio to `download/audio.{format}`
   - Writes manifest to `download/manifest.json`
   - Updates metadata with download info
   - Transitions to `DONE/{jobId}/`
5. On failure:
   - Classifies failure (CAPTCHA_REQUIRED, RATE_LIMITED, COPYRIGHT_RESTRICTED, DOWNLOAD_ERROR)
   - Updates metadata with reason, message, label
   - Transitions to `FAILED/{jobId}/`

**Failure Classification:** `server/lib/ytdlp-classifier.ts`

Deterministic parsing of yt-dlp stderr/stdout to classify refusals:
- **CAPTCHA_REQUIRED** — Bot verification detected
- **RATE_LIMITED** — Server rate limiting or wait required
- **COPYRIGHT_RESTRICTED** — Copyright/label block (UMG, SME, WMG, VEVO)
- **DOWNLOAD_ERROR** — Other download failures (fallback)

---

### rif-api: HTTP/tRPC Surface

**Responsibility:** Expose filesystem truth via HTTP, never infer state, never retry.

**API Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/jobs` | POST | Create job from URL (calls rif-core) |
| `/api/jobs` | GET | List jobs with filtering/pagination |
| `/api/jobs/:id` | GET | Get job details (state, metadata, artifacts) |
| `/api/jobs/:id/logs` | GET | Stream job logs |
| `/api/jobs/:id/artifacts` | GET | List job artifacts |
| `/api/health` | GET | Health check (filesystem and database status) |

**Design Principles:**

- **Read-Only Semantics** — API reads filesystem, never writes directly
- **Truth Exposure** — Refusal reasons surface verbatim from metadata
- **No Inference** — State is directory location, never inferred
- **No Retry Logic** — API reports status; client decides retry strategy
- **No Abstraction** — Metadata structure exposed as-is

---

## Building New Adapters

### Adapter Template

```typescript
import { readMetadata, writeMetadata, logToJobLog } from "../lib/filesystem";
import { moveJob } from "../lib/job-moves";
import { JobState, Actor } from "../lib/job-state";

export async function processMyAdapter(jobId: string): Promise<void> {
  try {
    // 1. Read metadata
    const metadata = await readMetadata(jobId);
    
    // 2. Verify preconditions
    if (metadata.state !== JobState.RUNNING) {
      throw new Error(`Expected RUNNING, got ${metadata.state}`);
    }

    // 3. Perform work
    const result = await doWork(metadata);

    // 4. Write artifacts
    await writeArtifacts(jobId, result);

    // 5. Update metadata
    metadata.myAdapter = {
      status: "COMPLETE",
      result: result,
      finishedAt: new Date().toISOString(),
    };
    await writeMetadata(jobId, metadata);

    // 6. Transition state (if applicable)
    // Only if adapter owns state transitions
    await moveJob(jobId, JobState.RUNNING, JobState.DONE, Actor.MY_ADAPTER);

  } catch (error) {
    // Log error
    await logToJobLog(jobId, `Error: ${error.message}`);
    
    // Update metadata with failure
    const metadata = await readMetadata(jobId);
    metadata.myAdapter = {
      status: "FAILED",
      error: error.message,
    };
    await writeMetadata(jobId, metadata);

    // Transition to FAILED (if applicable)
    // Only if adapter owns state transitions
    await moveJob(jobId, JobState.RUNNING, JobState.FAILED, Actor.MY_ADAPTER);
  }
}
```

### Adapter Constraints

**Non-Negotiable Rules:**

1. **State Ownership** — Only transition states you own
   - Lifecycle adapters: own CLAIMED→RUNNING→DONE/FAILED
   - Feature adapters: own no state transitions
   - Utility adapters: own system-level transitions only

2. **Filesystem Authority** — Always read/write filesystem first
   - Read metadata before any work
   - Write artifacts to job folder
   - Update metadata after work completes
   - Database updates are derived, not authoritative

3. **Idempotency** — Safe to re-run without side effects
   - Check if work already done (look for artifacts or metadata status)
   - Skip if already complete
   - Fail loudly on real errors

4. **Error Classification** — Fail deterministically
   - Classify failures into categories (not generic "error")
   - Surface reason in metadata
   - Log full error for debugging

5. **No Database Writes** — Filesystem is source of truth
   - Never write to database directly
   - Database is rebuilt from filesystem on startup
   - Metadata is the contract

---

## Job Metadata Schema

**Location:** `{STORAGE_ROOT}/jobs/{STATE}/{jobId}/metadata.json`

**Core Fields:**

```json
{
  "id": "uuid",
  "youtubeUrl": "https://youtube.com/watch?v=...",
  "state": "NEW|CLAIMED|RUNNING|DONE|FAILED",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "ownerId": "uuid (after claim)",
  "leaseExpiresAt": "ISO timestamp (after claim)",
  "download": {
    "status": "COMPLETE|FAILED",
    "reason": "CAPTCHA_REQUIRED|RATE_LIMITED|COPYRIGHT_RESTRICTED|DOWNLOAD_ERROR",
    "message": "Human-readable explanation",
    "label": "UMG|SME|WMG|VEVO (optional)",
    "error": "First line of stderr",
    "title": "Video title",
    "artist": "Channel name",
    "duration": 180,
    "fileFormat": "m4a",
    "filePath": "download/audio.m4a",
    "fileSize": 5242880,
    "downloadedAt": "ISO timestamp"
  },
  "separation": {
    "status": "COMPLETE|FAILED|NOT_STARTED",
    "model": "htdemucs",
    "device": "cuda|cpu",
    "error": "Error message (if failed)",
    "finishedAt": "ISO timestamp"
  },
  "lyrics": {
    "status": "COMPLETE|NOT_FOUND|FAILED",
    "provider": "genius",
    "confidence": 0.95,
    "error": "Error message (if failed)"
  },
  "audacity": {
    "status": "COMPLETE|FAILED",
    "projectPath": "audacity/project.aup3",
    "error": "Error message (if failed)"
  }
}
```

**Adapter Responsibility:** Add your own top-level field (e.g., `"myAdapter": {...}`) following the same pattern.

---

## Failure Modes & Recovery

### Crash Recovery

**Scenario:** Worker crashes mid-job

**Recovery:**

1. Job folder exists in `RUNNING/{jobId}/`
2. On startup, database rebuild scans filesystem
3. Lease check: if `leaseExpiresAt` is past, job is reclaimed to `NEW/{jobId}/`
4. Worker can retry from the beginning

**Guarantee:** No data loss, no orphaned jobs.

### Partial Artifacts

**Scenario:** Worker writes artifacts but crashes before metadata update

**Recovery:**

1. Metadata still shows old state (e.g., `RUNNING`)
2. Worker re-runs, detects existing artifacts
3. Worker skips work, updates metadata, transitions state
4. Idempotency ensures no duplication

**Guarantee:** Artifacts are never treated as success until metadata confirms.

### Database Corruption

**Scenario:** Database becomes inconsistent with filesystem

**Recovery:**

1. Delete database
2. Restart system
3. `initializeDatabaseFromFilesystem()` rebuilds from truth
4. All jobs reappear with correct state

**Guarantee:** Filesystem is always recoverable; database is ephemeral.

---

## Extension Points

### Adding a New Lifecycle Adapter

**Example:** Add a "transcription" adapter that processes audio to text.

**Steps:**

1. Define actor in `job-state.ts`: `TRANSCRIPTION_WORKER`
2. Define state transitions: `RUNNING → TRANSCRIPTION_COMPLETE`
3. Implement worker: `server/workers/transcription-worker.ts`
4. Register in job orchestration (queue or scheduler)
5. Update metadata schema with `transcription: { status, result, error }`

**Constraints:** Only transition states you own; never bypass state machine.

### Adding a New Feature Adapter

**Example:** Add a "metadata enrichment" adapter that looks up artist info.

**Steps:**

1. Implement worker: `server/workers/metadata-enrichment-worker.ts`
2. No state transitions (feature adapters don't own states)
3. Update metadata with new field: `enrichment: { status, data, error }`
4. Run after `DONE` state (no preconditions on state)

**Constraints:** Never modify job state; read-only filesystem operations except metadata updates.

---

## Testing Adapters

**Test Template:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createJobFolder, readMetadata, writeMetadata } from "../lib/filesystem";
import { processMyAdapter } from "./my-adapter";

describe("my-adapter", () => {
  let jobId: string;

  beforeEach(async () => {
    jobId = await createJobFolder("https://example.com");
  });

  it("should complete successfully", async () => {
    await processMyAdapter(jobId);
    const metadata = await readMetadata(jobId);
    expect(metadata.myAdapter.status).toBe("COMPLETE");
  });

  it("should fail loudly on error", async () => {
    // Set up error condition
    await expect(processMyAdapter(jobId)).rejects.toThrow();
  });

  it("should be idempotent", async () => {
    await processMyAdapter(jobId);
    await processMyAdapter(jobId); // Should not error
    const metadata = await readMetadata(jobId);
    expect(metadata.myAdapter.status).toBe("COMPLETE");
  });
});
```

---

## Guarantees Summary

| Guarantee | Mechanism | Verification |
|-----------|-----------|--------------|
| Filesystem Authority | State encoded in directory name | Tests verify directory location matches state |
| State Ownership | Actor validation in moveJob() | Tests verify unauthorized transitions fail |
| Atomicity | fs.rename() on same filesystem | Tests verify no partial states |
| Idempotency | Artifact detection + metadata check | Tests verify re-run produces same result |
| Restart-Safety | Database rebuild from filesystem | Tests verify delete DB + restart recovers all jobs |
| Observability | Structured logs + metadata | Tests verify all transitions logged |
| Deterministic Failure | Classification + metadata | Tests verify failures are classified, not generic |

---

## Out of Scope (Phase 1)

- Multi-user isolation (single-user system)
- Cloud storage (local filesystem only)
- GPU acceleration (CPU-only Demucs)
- Real-time progress streaming (polling acceptable)
- Web-based audio editing (offline tools only)
- Collaboration features

These are extension points for future phases, not framework limitations.

---

## References

- **FORGE_CONTRACT.md** — Phase 0 invariants and guarantees
- **PHASE0_SCHEMA.md** — Detailed job folder layout and metadata schema
- **STYLE_PRINCIPLES.md** — API/frontend language and clarity principles
- **server/lib/filesystem.ts** — Filesystem module implementation
- **server/lib/job-state.ts** — State machine implementation
- **server/workers/ytdlp-worker.ts** — Reference adapter implementation
