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
- [ ] Update server/routers/jobs.ts to use real filesystem instead of in-memory mock
- [ ] Verify tRPC endpoints work with real persistence (create, list, get, logs, artifacts)
- [ ] Verify UI renders correctly with real job state

## Phase 1: Test Coverage

- [x] Write vitest tests for job lifecycle transitions (NEW → CLAIMED → RUNNING → DONE/FAILED)
- [x] Write tests for illegal state transitions (should reject)
- [x] Write tests for failure modes (state machine validates all modes)
- [ ] Write tests for terminal state rendering in UI
- [x] Verify all tests pass before worker integration (63/63 passing ✅)

## Phase 2: Real Persistence Integration

- [ ] Update server/routers/jobs.ts to use filesystem instead of in-memory
- [ ] Test create endpoint with real filesystem
- [ ] Test list endpoint with real filesystem
- [ ] Test get endpoint with real filesystem
- [ ] Verify UI works unchanged with real persistence

## Phase 3: Worker Integration (Bull/BullMQ)

- [ ] Wire yt-dlp worker to job queue
- [ ] Wire Demucs worker to job queue
- [ ] Implement event emission for state transitions
- [ ] Verify workers respect state machine constraints
- [ ] Test end-to-end job progression with real workers

## Phase 3: UI Polish & Deployment

- [ ] Add basic styling (not required yet)
- [ ] Add error boundary for graceful failure handling
- [ ] Test crash recovery (jobs survive restarts)
- [ ] Deploy to production
