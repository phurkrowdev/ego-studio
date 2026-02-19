# E.G.O. Studio Audio — Crimson MVP Hardening (Validation-First)

## Completed Phases (1-7)

- [x] Phase 0: Filesystem authority, state machine, atomic moves (63/63 tests)
- [x] Phase 1: tRPC API contract (8 endpoints, 20 integration tests)
- [x] Phase 2: Real persistence (UI works unchanged, 95 jobs in filesystem)
- [x] Phase 3: Worker integration + Job detail UI (89/89 tests passing)
- [x] Phase 4A: Demucs worker + multi-stage pipeline (91/91 tests)
- [x] Phase 4B: Automatic orchestration + end-to-end tests (98/98 tests passing)
- [x] Phase 5: Real yt-dlp, Lyrics worker, UI enhancements (98/98 tests)
- [x] Phase 6: Real Demucs, Audacity worker, full 4-stage pipeline (98/98 tests)
- [x] Phase 7: Production-grade external integrations, Genius API, webhooks (117/117 tests)

**Current Status:** 117 tests passing, 4-stage pipeline operational, deterministic state machine intact.

---

## Phase 8: Crimson MVP Hardening (Validation-First, Local-First)

### 8.1: File Upload Infrastructure (Local-First, 200MB cap)

**Objective:** Accept audio files (WAV, MP3, AIFF, FLAC), validate, and store locally. No resumable uploads. Local storage first, S3 deferred to Phase 8.7.

- [ ] Create `server/lib/file-upload.ts` with validation
  - [ ] Accept MIME types: audio/wav, audio/mpeg, audio/flac, audio/aiff
  - [ ] Enforce 200MB file size limit
  - [ ] Reject invalid files with user-facing error message
  - [ ] Stream upload to local filesystem (STORAGE_ROOT/uploads/)
  - [ ] Return file metadata: filename, size, format, duration (optional, can skip duration)
  - [ ] No resumable uploads in this sprint

- [ ] Update `server/routers/jobs.ts`
  - [ ] Modify `create` endpoint: accept file upload instead of URL
  - [ ] Input schema: `z.object({ file: z.instanceof(File), metadata?: z.object({...}) })`
  - [ ] Output: Same `JobResponse` shape (contract locked, no changes)
  - [ ] Call `createJobFromFile(file)` internally

- [ ] Update `server/lib/jobs-service.ts`
  - [ ] Add `createJobFromFile(file)` function
  - [ ] Call `filesystem.createJobFolder(fileMetadata)` instead of URL
  - [ ] Store file metadata in job: `{ filename, size, format, s3Key: null, uploadedAt }`
  - [ ] Ensure backward compatibility with existing URL-based jobs (optional)

- [ ] Update `server/lib/filesystem.ts`
  - [ ] Modify `createJobFolder()` to accept file metadata instead of URL
  - [ ] Store metadata in `metadata.json`: `{ filename, size, format, uploadedAt }`
  - [ ] Remove YouTube-specific fields from new jobs (keep for existing jobs)

- [ ] Write vitest tests (5+ tests)
  - [ ] Test valid file upload (WAV, MP3, AIFF, FLAC)
  - [ ] Test invalid MIME type rejection
  - [ ] Test file size limit enforcement (reject >200MB)
  - [ ] Test streaming to local filesystem
  - [ ] Test error messages (no stack traces)

**Success Metric:** File upload endpoint works, 200MB limit enforced, local storage functional.

---

### 8.2: Artifact Packaging & Cleanup (ZIP structure, 7-14 day retention)

**Objective:** Generate clean ZIP artifacts with consistent naming. Implement 7-14 day retention + automatic cleanup cron.

- [ ] Create `server/lib/artifact-packaging.ts`
  - [ ] Generate ZIP with structure: `Artist - Track/stems/`, `lyrics.txt`, `project.aup3`
  - [ ] Sanitize artist/track names (remove special chars, spaces → underscores)
  - [ ] Implement idempotent ZIP generation (safe to retry)
  - [ ] Store ZIP locally (STORAGE_ROOT/artifacts/)
  - [ ] Return ZIP file path and local URL

- [ ] Add `jobs.downloadArtifacts` endpoint
  - [ ] Input: `z.object({ jobId })`
  - [ ] Return: `{ zipPath, zipUrl, expiresAt }`
  - [ ] Verify job is DONE before allowing download

- [ ] Update Audacity worker
  - [ ] After `.aup3` generation, call `packageArtifacts(jobId)` to create ZIP
  - [ ] Store ZIP path in job metadata
  - [ ] Log ZIP generation success/failure

- [ ] Create `server/lib/artifact-cleanup.ts`
  - [ ] Scan STORAGE_ROOT/artifacts/ for files older than 14 days
  - [ ] Delete old ZIP files
  - [ ] Log cleanup operations
  - [ ] Implement as cron job (run daily at 2 AM)

- [ ] Wire cleanup cron in `server/_core/index.ts`
  - [ ] Schedule artifact cleanup job
  - [ ] Log cleanup results

- [ ] Write vitest tests (4+ tests)
  - [ ] Test ZIP generation with valid stems
  - [ ] Test ZIP structure validation
  - [ ] Test filename sanitization
  - [ ] Test idempotent packaging (retry-safe)

**Success Metric:** ZIP artifacts generated on job completion, cleanup cron functional, 7-14 day retention enforced.

---

### 8.3: Failure UX Hardening (user-facing errors, retry consistency)

**Objective:** Clear user-facing error messages, no internal stack traces, consistent retry buttons.

- [ ] Create `server/lib/error-messages.ts`
  - [ ] Define user-facing messages for all failure modes:
    - `CAPTCHA_REQUIRED` → "YouTube blocked this request. Please try again later."
    - `RATE_LIMITED` → "Too many requests. Please wait before retrying."
    - `COPYRIGHT_RESTRICTED` → "This content is copyright-protected and cannot be processed."
    - `DOWNLOAD_ERROR` → "Failed to download audio. Please check the URL and try again."
    - `GPU_MEMORY` → "Processing failed due to server capacity. Please try again later."
    - `INVALID_AUDIO_FORMAT` → "Audio format not supported. Please use WAV, MP3, AIFF, or FLAC."
    - `TIMEOUT` → "Processing took too long. Please try a shorter audio file."
    - `FILE_UPLOAD_ERROR` → "File upload failed. Please check file size and format."
    - `FILE_TOO_LARGE` → "File is too large. Maximum size is 200MB."
    - `INVALID_FILE_FORMAT` → "File format not supported. Please use WAV, MP3, AIFF, or FLAC."

- [ ] Update Job response shape
  - [ ] Add `userMessage` field to metadata stages (download, separation, lyrics, audacity)
  - [ ] Populate `userMessage` when job fails
  - [ ] Never expose internal error details to frontend

- [ ] Update `server/lib/jobs-service.ts`
  - [ ] Call `getErrorMessage(reason)` when job fails
  - [ ] Store `userMessage` in job metadata

- [ ] Update `client/src/pages/JobDetail.tsx`
  - [ ] Display `userMessage` in error section (not `reason`)
  - [ ] Keep technical logs visible for debugging
  - [ ] Ensure retry button visible and consistent across all failure states

- [ ] Write vitest tests (3+ tests)
  - [ ] Test error message mapping for all failure modes
  - [ ] Test no stack traces in user messages
  - [ ] Test retry button visibility

**Success Metric:** Clear error messages displayed, no stack traces, retry buttons consistent.

---

### 8.4: User Ownership & Concurrency (per-user 1-2 max, ownership enforcement)

**Objective:** Enforce per-user job ownership, implement 1-2 concurrent job limit per user.

- [ ] Update database schema
  - [ ] Add `userId` to `jobs` table (from auth context)
  - [ ] Add index on `(userId, state)` for efficient querying

- [ ] Create `server/lib/concurrency-limiter.ts`
  - [ ] Check concurrent jobs per user (default 1-2 max)
  - [ ] Return `{ allowed: boolean, running: number, limit: number }`
  - [ ] Use database query to count CLAIMED/RUNNING jobs for user

- [ ] Update `jobs.create` endpoint
  - [ ] Extract `userId` from auth context
  - [ ] Call `checkConcurrencyLimit(userId)` before creating job
  - [ ] Return 429 Too Many Requests if limit exceeded
  - [ ] Include `Retry-After` header

- [ ] Update `jobs.list` endpoint
  - [ ] Filter jobs by `userId` (users only see their own jobs)
  - [ ] Admins can see all jobs (optional, defer to Phase 9)

- [ ] Update `jobs.get` endpoint
  - [ ] Verify `userId` matches (users only access their own jobs)

- [ ] Update `jobs.retry` endpoint
  - [ ] Verify `userId` matches before allowing retry

- [ ] Write vitest tests (4+ tests)
  - [ ] Test concurrent job limit (reject 3rd job)
  - [ ] Test per-user isolation (user A can't see user B's jobs)
  - [ ] Test 429 response code
  - [ ] Test concurrency counter accuracy

**Success Metric:** Per-user job ownership enforced, 1-2 concurrent limit working, tests passing.

---

### 8.5: Error Message Hardening & UI Polish

**Objective:** Polish UI for file upload, display user-facing errors, show concurrency status.

- [ ] Update `client/src/pages/Home.tsx`
  - [ ] Replace `JobSubmitForm` with `FileUploadForm`
  - [ ] Implement drag-and-drop file upload
  - [ ] Display file metadata (name, size)
  - [ ] Show upload progress bar
  - [ ] Accept only WAV, MP3, AIFF, FLAC
  - [ ] Display file size validation error if oversized
  - [ ] Keep `JobList` and navigation unchanged

- [ ] Create `client/src/components/FileUploadForm.tsx`
  - [ ] Drag-and-drop zone with visual feedback
  - [ ] Click to browse file picker
  - [ ] Display selected file metadata
  - [ ] Show upload progress (bytes uploaded / total)
  - [ ] Handle upload errors gracefully
  - [ ] Call `trpc.jobs.create` with file

- [ ] Update `client/src/pages/JobDetail.tsx`
  - [ ] Display file metadata instead of YouTube URL
  - [ ] Show user-facing error messages (not technical reasons)
  - [ ] Display concurrency status if limit reached
  - [ ] Keep logs and retry button unchanged

- [ ] Write integration tests (2+ tests)
  - [ ] Test file upload form rendering
  - [ ] Test file validation (reject invalid formats)

**Success Metric:** File-upload-first UI complete, YouTube removed from primary surface, error messages clear.

---

### 8.6: Local Deployment Testing (3 producer testers)

**Objective:** Deploy locally and test with 3 producer testers. Validate core workflow.

- [ ] Prepare local deployment guide
  - [ ] Document setup instructions (clone, pnpm install, env vars)
  - [ ] Document how to run dev server
  - [ ] Document how to access UI (localhost:3000)

- [ ] Recruit 3 producer testers
  - [ ] Target: beat makers, music producers
  - [ ] Provide local deployment guide
  - [ ] Collect feedback on workflow

- [ ] Test core workflow with testers
  - [ ] Upload audio file (WAV, MP3, AIFF, FLAC)
  - [ ] Monitor job progression through 4 stages
  - [ ] Download ZIP artifact
  - [ ] Verify ZIP structure (stems, lyrics, .aup3)
  - [ ] Test error scenarios (invalid format, oversized file)
  - [ ] Test retry button on failed jobs

- [ ] Collect feedback
  - [ ] What worked well?
  - [ ] What was confusing?
  - [ ] What would make it more useful?
  - [ ] Would you pay for this?

- [ ] Document results
  - [ ] Create `PRODUCER_FEEDBACK.md` with findings
  - [ ] Identify quick wins vs. future work

**Success Metric:** 3 producers tested locally, core workflow validated, 1+ willing to pay.

---

### 8.7: S3 Abstraction & Cloud Deployment (final third)

**Objective:** Defer to final third of sprint. Abstract storage layer for S3-compatible backends (Backblaze B2, etc.).

- [ ] Create `server/lib/storage-abstraction.ts`
  - [ ] Abstract storage interface (local vs S3)
  - [ ] Implement local storage adapter (existing)
  - [ ] Implement S3 adapter (using `storagePut` helper)
  - [ ] Environment-based selection (STORAGE_TYPE=local|s3)

- [ ] Update artifact packaging to use abstraction
  - [ ] Store artifacts via abstraction layer
  - [ ] Support both local and S3 URLs

- [ ] Create Dockerfile
  - [ ] Node.js base image
  - [ ] Install Demucs, yt-dlp (optional)
  - [ ] Copy app code
  - [ ] Expose port 3000

- [ ] Create docker-compose.yml
  - [ ] Node API service
  - [ ] Redis service (for Bull queue)
  - [ ] Optional: MinIO for local S3-compatible storage

- [ ] Document cloud deployment
  - [ ] Update `DEPLOYMENT.md` with cloud instructions
  - [ ] GPU requirements (4GB VRAM minimum)
  - [ ] Environment variables for S3

**Success Metric:** S3 abstraction working, Docker deployment functional, cloud-ready.

---

### 8.8: Crimson MVP Completion & Legal Review

**Objective:** Verify all criteria met, legal review complete, ready for producer testing.

- [ ] Create `CRIMSON_MVP_CHECKLIST.md`
  - [ ] Technical criteria: 130+ tests passing, 0 TypeScript errors
  - [ ] UX criteria: file upload default, clear error messages, consistent retry buttons
  - [ ] Deployment criteria: local deployment working, 3 producers tested
  - [ ] Legal criteria: no YouTube piracy, file-based ingestion only
  - [ ] Commercial criteria: 1+ willing to pay, no red flags

- [ ] Run full test suite
  - [ ] Target: 130+ tests passing (117 existing + 13+ new)
  - [ ] Zero TypeScript errors

- [ ] Legal review
  - [ ] Verify TOS clarity (user owns audio rights)
  - [ ] Verify DMCA compliance process documented
  - [ ] Verify no downloader framing
  - [ ] Verify artifact retention policy (7-14 days)

- [ ] Final checkpoint
  - [ ] Save checkpoint with Crimson MVP complete
  - [ ] Document completion date and metrics

**Success Metric:** All criteria verified, legal review passed, ready for commercialization.

---

## Key Constraints (Validation-First)

- **Local-first storage:** No S3 in Phases 8.1-8.6. S3 deferred to Phase 8.7.
- **No resumable uploads:** Simple file upload, no resume logic.
- **Simplified rate limiting:** Per-user concurrent limit only (1-2 max). No hourly quota yet.
- **Deterministic state machine:** Preserved intact. No changes to state transitions.
- **Test coverage discipline:** Don't optimize for test count. Preserve coverage of critical paths.
- **Primary success metric:** 3 producer testers using local deployment successfully.

---

## Timeline (Validation-First)

| Phase | Days | Deliverable |
|-------|------|-------------|
| 8.1 | 1-4 | File upload infrastructure (local-first, 200MB cap) |
| 8.2 | 5-8 | ZIP packaging + cleanup cron (7-14 day retention) |
| 8.3 | 9-12 | Failure UX hardening (user-facing errors, retry consistency) |
| 8.4 | 13-16 | User ownership + concurrency (per-user 1-2 max) |
| 8.5 | 17-20 | Error message hardening + UI polish |
| 8.6 | 21-24 | Local deployment testing (3 producer testers) |
| 8.7 | 25-28 | S3 abstraction + cloud deployment (final third) |
| 8.8 | 29-30 | Completion checklist + legal review |

**Total: 30 days to Crimson MVP ready for commercialization.**
