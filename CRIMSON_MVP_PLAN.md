# Crimson MVP Hardening Phase — Implementation Plan

**Objective:** Convert the 4-stage audio processing pipeline from YouTube-first to file-upload-first MVP, hardened for legal defensibility and producer testing within 30 days.

**Current Status:** 117 tests passing, full 4-stage pipeline operational, deterministic state machine intact.

---

## Phase Breakdown & Timeline

### Phase 8.1: File Upload Infrastructure (Days 1-5)

**Goal:** Implement robust file upload handling with validation, streaming, and storage.

**Key Changes:**

1. **Create `server/lib/file-upload.ts`**
   - Accept WAV, MP3, AIFF, FLAC with MIME type validation
   - Enforce max file size (configurable, default 500MB)
   - Validate audio format using ffprobe or similar (optional, can defer)
   - Stream upload safely to S3 via `storagePut()` helper
   - Return file metadata: filename, size, duration, bitrate, format
   - Reject invalid files with clear, user-facing error messages

2. **Update `server/routers/jobs.ts`**
   - Modify `create` endpoint to accept file upload instead of URL
   - Input: `z.object({ file: z.instanceof(File), metadata?: z.object({...}) })`
   - Output: Same `JobResponse` shape (contract locked)
   - Internally call `createJobFromFile(file)` instead of `createJobFromUrl(url)`

3. **Update `server/lib/jobs-service.ts`**
   - Add `createJobFromFile(file)` function
   - Call `filesystem.createJobFolder(fileMetadata)` instead of URL
   - Store file metadata in job metadata: `{ filename, size, format, duration, s3Key }`
   - Ensure backward compatibility with existing URL-based jobs (optional)

4. **Update `server/lib/filesystem.ts`**
   - Modify `createJobFolder()` to accept file metadata instead of URL
   - Store metadata in `metadata.json`: `{ filename, size, format, duration, s3Key, createdAt }`
   - Remove YouTube-specific fields (optional, can keep for backward compat)

5. **Testing (8+ tests)**
   - Test valid file uploads (WAV, MP3, AIFF, FLAC)
   - Test invalid MIME types (reject cleanly)
   - Test file size limits (reject oversized)
   - Test streaming to S3 (mock storagePut)
   - Test metadata extraction
   - Test error messages (no stack traces)

**Deliverable:** File upload infrastructure complete, all tests passing, no API contract changes.

---

### Phase 8.2: Artifact Packaging — ZIP Generation (Days 6-10)

**Goal:** Generate clean, structured ZIP artifacts with consistent naming.

**Key Changes:**

1. **Create `server/lib/artifact-packaging.ts`**
   - Generate ZIP with structure: `Artist - Track/stems/`, `lyrics.txt`, `project.aup3`
   - Sanitize artist/track names (remove special chars, spaces → underscores)
   - Implement idempotent ZIP generation (safe to retry)
   - Use `archiver` npm package or `zip` command
   - Return ZIP file path and S3 URL

2. **Add Download Endpoint to `server/routers/jobs.ts`**
   - New endpoint: `downloadArtifacts: publicProcedure.input(z.object({ jobId })).query(...)`
   - Return presigned S3 URL for ZIP download
   - Or stream ZIP directly (depends on file size)

3. **Update Audacity Worker**
   - After `.aup3` generation, call `packageArtifacts(jobId)` to create ZIP
   - Store ZIP S3 URL in job metadata
   - Log ZIP generation success/failure

4. **Update JobDetail UI**
   - Add "Download Artifacts" button (visible only when job is DONE)
   - Link to presigned S3 URL or download endpoint
   - Show ZIP contents preview (optional)

5. **Testing (6+ tests)**
   - Test ZIP generation with valid stems
   - Test ZIP structure validation
   - Test filename sanitization
   - Test idempotent packaging (retry-safe)
   - Test S3 upload
   - Test download endpoint

**Deliverable:** ZIP artifacts generated on job completion, downloadable via UI.

---

### Phase 8.3: Failure UX Hardening (Days 11-15)

**Goal:** Clear user-facing error messages, no internal stack traces, consistent retry buttons.

**Key Changes:**

1. **Define User-Facing Error Messages**
   - Create `server/lib/error-messages.ts`
   - Map internal failure reasons to user-friendly messages:
     - `CAPTCHA_REQUIRED` → "YouTube blocked this request. Please try again later."
     - `RATE_LIMITED` → "Too many requests. Please wait before retrying."
     - `COPYRIGHT_RESTRICTED` → "This content is copyright-protected and cannot be processed."
     - `DOWNLOAD_ERROR` → "Failed to download audio. Please check the URL and try again."
     - `GPU_MEMORY` → "Processing failed due to server capacity. Please try again later."
     - `INVALID_AUDIO_FORMAT` → "Audio format not supported. Please use WAV, MP3, AIFF, or FLAC."
     - `TIMEOUT` → "Processing took too long. Please try a shorter audio file."
     - `FILE_UPLOAD_ERROR` → "File upload failed. Please check file size and format."
     - `FILE_TOO_LARGE` → "File is too large. Maximum size is 500MB."
     - `INVALID_FILE_FORMAT` → "File format not supported. Please use WAV, MP3, AIFF, or FLAC."

2. **Update Job Response Shape**
   - Add `userMessage` field to `metadata.download/separation/lyrics/audacity`:
     - `{ status, reason?, userMessage?, label? }`
   - Populate `userMessage` when job fails
   - Never expose internal error details to frontend

3. **Update JobDetail UI**
   - Display `userMessage` in error section (not `reason`)
   - Keep technical logs visible for debugging (but not in error message)
   - Ensure retry button visible and consistent across all failure states

4. **Testing (4+ tests)**
   - Test error message mapping for all failure modes
   - Test no stack traces in user messages
   - Test retry button visibility
   - Test log visibility (technical logs still available)

**Deliverable:** Clear error messages, no stack traces, consistent UX across failures.

---

### Phase 8.4: Usage Guardrails (Days 16-20)

**Goal:** Protect GPU resources with per-user rate limiting and concurrent job limits.

**Key Changes:**

1. **Update Database Schema**
   - Add to `jobs` table: `userId` (from auth context)
   - Add to `users` table (if not exists): `jobsCreatedToday`, `jobsCreatedThisHour`, `lastJobTime`
   - Or use separate `user_quotas` table

2. **Create `server/lib/rate-limiter.ts`**
   - Check concurrent jobs per user (default 3)
   - Check jobs per hour (default 10)
   - Return `{ allowed: boolean, remaining: number, resetAt: Date }`
   - Use in-memory cache or database for tracking

3. **Update `jobs.create` Endpoint**
   - Call `checkRateLimit(userId)` before creating job
   - Return 429 Too Many Requests if limit exceeded
   - Include `Retry-After` header

4. **Update JobList UI**
   - Display user quota: "3/10 jobs used this month"
   - Show "Rate limited" message if user hits limit
   - Display reset time if applicable

5. **Testing (5+ tests)**
   - Test concurrent job limit (reject 4th job)
   - Test hourly rate limit (reject 11th job)
   - Test quota reset after time window
   - Test 429 response code
   - Test quota display in UI

**Deliverable:** Rate limiting enforced, quota display in UI, tests passing.

---

### Phase 8.5: Deployment Readiness (Days 21-23)

**Goal:** Document GPU requirements, environment variables, and deployment configuration.

**Key Changes:**

1. **Create `DEPLOYMENT.md`**
   - GPU requirements for Demucs:
     - Minimum: 4GB VRAM (CPU fallback available)
     - Recommended: 8GB+ VRAM for parallel processing
     - Supported: NVIDIA CUDA 11.8+, AMD ROCm, CPU mode
   - Environment variables:
     - `STORAGE_ROOT`: Job storage directory (default `/tmp/ego-studio-jobs`)
     - `GENIUS_API_TOKEN`: Genius API key (optional, fallback to mock)
     - `WEBHOOK_SECRET`: HMAC signing key (optional)
     - `MAX_FILE_SIZE`: Max upload size in bytes (default 500MB)
     - `MAX_CONCURRENT_JOBS`: Per-user limit (default 3)
     - `MAX_JOBS_PER_HOUR`: Rate limit (default 10)
     - `DEMUCS_TIMEOUT`: Processing timeout in seconds (default 600)
     - `DATABASE_URL`: MySQL/TiDB connection (optional, graceful degradation)
   - Single-node deployment:
     - Bull queue works without Redis (uses in-memory adapter)
     - Filesystem is source of truth (no database required)
     - S3 storage required for artifacts
   - S3 compatibility:
     - Supports AWS S3, MinIO, DigitalOcean Spaces, etc.
     - Uses `storagePut()` helper (abstracted in `server/storage.ts`)

2. **Create `ARCHITECTURE.md`**
   - System overview (4-stage pipeline)
   - State machine (NEW → CLAIMED → RUNNING → DONE/FAILED)
   - Worker architecture (yt-dlp, Demucs, Lyrics, Audacity)
   - Filesystem authority (no in-memory state)
   - Deployment topology (single-node, multi-node)

3. **Add Health Check Endpoint**
   - Existing: `jobs.health` returns queue status
   - Add checks for:
     - Filesystem accessibility
     - S3 connectivity (if configured)
     - Database connectivity (if configured)
     - Demucs binary availability
     - yt-dlp binary availability (optional)

4. **Testing (implicit)**
   - Verify documentation accuracy
   - Test single-node deployment (no Redis)
   - Test S3 abstraction with MinIO

**Deliverable:** Deployment documentation complete, health checks in place.

---

### Phase 8.6: UI Refactor — File-Upload-First (Days 24-27)

**Goal:** Remove YouTube from primary UI surface, make file upload the default.

**Key Changes:**

1. **Update `client/src/pages/Home.tsx`**
   - Replace `JobSubmitForm` with `FileUploadForm`
   - Implement drag-and-drop file upload
   - Display file metadata (name, size, duration)
   - Show upload progress bar (using FormData + fetch)
   - Accept only WAV, MP3, AIFF, FLAC
   - Display file size validation error if oversized
   - Keep `JobList` and navigation unchanged

2. **Create `client/src/components/FileUploadForm.tsx`**
   - Drag-and-drop zone with visual feedback
   - Click to browse file picker
   - Display selected file metadata
   - Show upload progress (bytes uploaded / total)
   - Handle upload errors gracefully
   - Call `trpc.jobs.create` with file

3. **Update `client/src/pages/JobDetail.tsx`**
   - Display file metadata instead of YouTube URL
   - Show "Download Artifacts" button when job is DONE
   - Display user-facing error messages (not technical reasons)
   - Keep logs and retry button unchanged

4. **Update `client/src/App.tsx`**
   - Navigation unchanged (Home, Job List, Job Detail)
   - Preserve routing structure

5. **Testing (3+ tests)**
   - Test file upload form rendering
   - Test drag-and-drop interaction
   - Test file validation (reject invalid formats)
   - Test upload progress display
   - Test error message display

**Deliverable:** File-upload-first UI complete, YouTube removed from primary surface.

---

### Phase 8.7: Testing & Validation (Days 28-29)

**Goal:** Comprehensive testing across all new features.

**Key Changes:**

1. **Run Full Test Suite**
   - 117 existing tests + 40+ new tests = 160+ tests
   - Target: 100% pass rate
   - Zero TypeScript errors

2. **Manual Testing Checklist**
   - Upload valid audio file (WAV, MP3, AIFF, FLAC)
   - Verify job created with file metadata
   - Monitor job progression through 4 stages
   - Verify ZIP artifact generated on completion
   - Download ZIP and verify structure
   - Test error scenarios (invalid format, oversized file, rate limit)
   - Test retry button on failed jobs
   - Test rate limiting (hit limit, verify 429 response)
   - Test quota display in UI

3. **Integration Tests**
   - End-to-end: upload → process → download
   - Multi-job: upload 3 files, verify concurrent limit
   - Rate limit: upload 10 files, verify 11th rejected
   - Error recovery: upload invalid file, retry with valid file

**Deliverable:** All tests passing, manual testing complete, ready for producer testing.

---

### Phase 8.8: Crimson MVP Completion Checklist (Day 30)

**Goal:** Concrete definition of done, verification of all criteria.

**Key Changes:**

1. **Create `CRIMSON_MVP_CHECKLIST.md`**
   - Technical criteria:
     - [ ] 160+ tests passing (117 existing + 40+ new)
     - [ ] 0 TypeScript errors
     - [ ] All features working end-to-end
     - [ ] No YouTube URLs in primary UI
     - [ ] File upload default and only visible path
   - UX criteria:
     - [ ] Clear user-facing error messages (no stack traces)
     - [ ] Consistent retry buttons across all failure states
     - [ ] File metadata displayed (name, size, duration)
     - [ ] Upload progress bar visible
     - [ ] Quota display in UI
     - [ ] Download button for artifacts
   - Deployment criteria:
     - [ ] GPU requirements documented
     - [ ] All environment variables documented
     - [ ] Single-node queue working (no Redis required)
     - [ ] S3 abstraction supports S3-compatible backends
     - [ ] Health check endpoint functional
   - Legal criteria:
     - [ ] No direct YouTube piracy (file-based ingestion only)
     - [ ] yt-dlp remains internal adapter (not marketed)
     - [ ] User uploads own audio files
     - [ ] Lyrics API integration legal (Genius with fallback)
     - [ ] Audacity project generation legal (user-owned stems)

2. **Verification**
   - Run full test suite: `pnpm test`
   - Check TypeScript: `pnpm check`
   - Manual testing checklist (see Phase 8.7)
   - Verify all checklist items before final checkpoint

**Deliverable:** Crimson MVP Completion Checklist verified, ready for producer testing.

---

## Architecture Decisions

### File Upload vs YouTube

**Why file-upload-first?**
- **Legal defensibility:** Users upload their own audio, no piracy concerns
- **Clarity:** No ambiguity about content ownership
- **Scope:** Demucs + Lyrics + Audacity work on any audio, not just YouTube
- **Producer testing:** Beat makers already have local files, easier to test

**Why keep yt-dlp?**
- Internal adapter for advanced users (optional, not marketed)
- Backward compatibility with existing jobs
- Can be re-enabled later if legal review permits

### Rate Limiting Strategy

**Per-user limits (not global):**
- Max 3 concurrent jobs per user
- Max 10 jobs per hour per user
- Prevents resource hogging, allows multiple users

**Why not per-IP?**
- Users behind corporate proxies share IP
- Per-user is more fair and accurate

### Artifact Packaging

**ZIP structure:**
```
Artist - Track/
  stems/
    drums.wav
    vocals.wav
    bass.wav
    other.wav
  lyrics.txt
  project.aup3
```

**Why ZIP?**
- Single download for all artifacts
- Portable across systems
- Compatible with Audacity (can import stems)
- Easy to share with collaborators

### Error Messages

**User-facing vs technical:**
- User message: "YouTube blocked this request. Please try again later."
- Technical reason: `CAPTCHA_REQUIRED` (in logs only)
- Prevents information leakage, improves UX

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| File upload fails mid-stream | Implement resumable uploads (optional, Phase 9) |
| ZIP generation fails | Retry logic already in place, fallback to individual downloads |
| Rate limit too strict | Configurable limits, can adjust based on feedback |
| S3 unavailable | Graceful degradation, store artifacts locally (temporary) |
| Demucs GPU OOM | Timeout + fallback to CPU mode (already implemented) |

---

## Success Metrics

- **Technical:** 160+ tests passing, 0 TypeScript errors, all features working
- **UX:** File upload default, clear error messages, consistent retry buttons
- **Deployment:** Single-node working, S3 abstraction verified, health checks functional
- **Legal:** No YouTube piracy, file-based ingestion only, Genius API legal
- **Producer testing:** 3-5 beta users, 80%+ feature completion, <5 critical bugs

---

## Timeline Summary

| Phase | Days | Deliverable |
|-------|------|-------------|
| 8.1 | 1-5 | File upload infrastructure |
| 8.2 | 6-10 | ZIP artifact packaging |
| 8.3 | 11-15 | Error message hardening |
| 8.4 | 16-20 | Rate limiting & quotas |
| 8.5 | 21-23 | Deployment documentation |
| 8.6 | 24-27 | File-upload-first UI |
| 8.7 | 28-29 | Testing & validation |
| 8.8 | 30 | Completion checklist |

**Total: 30 days to Crimson MVP ready for producer testing.**

---

## Next Steps (Post-Crimson)

1. **Phase 9:** Producer feedback integration (bug fixes, UX improvements)
2. **Phase 10:** Stripe integration for simple billing ($0.99/job or $9.99/month)
3. **Phase 11:** Advanced features (batch processing, custom Demucs models, audio preview)
4. **Phase 12:** Marketing & growth (landing page, social proof, partnerships)
