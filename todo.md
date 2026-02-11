# E.G.O. Studio Audio — Project TODO

## Phase 0: Infrastructure (Filesystem Authority & State Machine)

- [x] Create server/lib/filesystem.ts (directory layout, atomic moves, state dirs)
- [x] Create server/lib/job-state.ts (state machine, transition validation, ownership)
- [x] Create server/lib/job-moves.ts (atomic directory moves, race-safe transitions)
- [x] Create server/lib/db-init.ts (database rebuild from filesystem on startup)
- [x] Add jobs table to drizzle/schema.ts
- [x] Write vitest tests for filesystem module (15 tests)
- [x] Write vitest tests for state machine (33 tests)
- [x] Write vitest tests for atomic moves (14 tests)
- [x] Fix test isolation issue (dependency injection + unique temp dirs)
- [x] All 63/63 Phase 0 tests passing
- [x] Update server/routers/jobs.ts to use real filesystem instead of in-memory mock
- [x] Verify tRPC endpoints work with real persistence (create, list, get, logs, artifacts)
- [x] Verify UI renders correctly with real job state

## Phase 1: Test Coverage

- [x] Write vitest tests for job lifecycle transitions (NEW → CLAIMED → RUNNING → DONE/FAILED)
- [x] Write tests for illegal state transitions (should reject)
- [x] Write tests for failure modes (state machine validates all modes)
- [x] Write tests for terminal state rendering in UI (via JobDetail component)
- [x] Verify all tests pass before worker integration (63/63 passing ✅)

## Phase 2: Real Persistence Integration

- [x] Create server/lib/jobs-service.ts (thin wrapper around Phase 0)
- [x] Update server/routers/jobs.ts to use JobsService instead of in-memory
- [x] Write 20 integration tests for JobsService (all passing)
- [x] Verify all 7 endpoints work with real filesystem
- [x] Verify UI works unchanged with real persistence (95 jobs, proper state display)

## Phase 3: Worker Integration (Bull/BullMQ) & UI

- [x] Wire yt-dlp worker to job queue (server/workers/yt-dlp-worker.ts)
- [x] Bull queue initialization (server/lib/queue.ts)
- [x] Implement retry logic (server/lib/jobs-service-retry.ts)
- [x] Add retry endpoint to router
- [x] Build job detail view UI (client/src/pages/JobDetail.tsx)
- [x] Real-time logs with polling
- [x] Artifacts display
- [x] Navigation from list to detail
- [x] Wire Demucs worker to job queue
- [x] Test end-to-end with multi-stage pipeline

## Summary

**Infrastructure Complete:**
- ✅ Phase 0: Filesystem authority, state machine, atomic moves (63/63 tests)
- ✅ Phase 1: tRPC API contract (8 endpoints, 20 integration tests)
- ✅ Phase 2: Real persistence (UI works unchanged, 95 jobs in filesystem)
- ✅ Phase 3: Worker integration + Job detail UI (89/89 tests passing)
- ✅ Phase 4A: Demucs worker + multi-stage pipeline (91/91 tests)
- ✅ Phase 4B: Automatic orchestration + end-to-end tests (98/98 tests passing)

**Key Achievements:**
- Swapped implementation without changing API
- UI works unchanged with real persistence
- All state transitions validated by state machine
- Filesystem is authoritative source of truth
- Multi-stage pipeline: yt-dlp → Demucs with auto-enqueue
- Job detail page with real-time logs and artifacts
- Retry logic for FAILED jobs
- 98 tests covering all critical paths
- Comprehensive logging at all stages
- Contract fully locked (no API changes needed)

## Phase 4A: Demucs Worker Integration

- [x] Create server/workers/demucs-worker.ts (mock execution, 5% failure rate)
- [x] Update state machine for multi-stage pipeline (DONE → CLAIMED allowed)
- [x] Update job-state.ts isTerminalState/isIntermediateState for multi-stage
- [x] Update job-state.test.ts for multi-stage transitions (91/91 tests passing)
- [x] Integrate Demucs worker into Bull queue (server/lib/queue.ts)
- [x] Auto-enqueue Demucs after yt-dlp completes

## Phase 4B: Automatic Multi-Stage Queue Orchestration

- [x] Wire Demucs auto-enqueue after yt-dlp completion (yt-dlp-worker.ts)
- [x] Add comprehensive logging for all stages
- [x] Write end-to-end integration tests (7 tests, all passing)
- [x] Verify multi-stage pipeline with real state transitions
- [x] Verify artifacts tracked through pipeline
- [x] Verify logs maintained across stages
- [x] All 98 tests passing

## Phase 4C: Polish & Deployment

- [ ] Add styling to job detail page
- [ ] Implement real yt-dlp integration
- [ ] Implement real Demucs integration
- [ ] Add Lyrics worker
- [ ] Add Audacity worker
- [ ] End-to-end testing with real workers
- [ ] Performance optimization
- [ ] Add error boundary for graceful failure handling
- [ ] Test crash recovery (jobs survive restarts)
- [ ] Deploy to production
