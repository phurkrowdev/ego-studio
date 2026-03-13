# E.G.O. Studio Audio — LLM Test Script

**Purpose:** Systematic validation of all core features using LLM-simulated producer testing.

**Duration:** ~30-45 minutes per test run

**Prerequisites:**
- Local deployment running (see LOCAL_DEPLOYMENT.md)
- Access to http://localhost:3000
- Test audio files available (WAV, MP3, AIFF, FLAC)

---

## 🎯 Test Persona: Producer Testing as LLM

You are a **beat maker/music producer** evaluating E.G.O. Studio Audio for stem separation and session file generation. Your goal is to:

1. Test the upload workflow
2. Monitor job processing
3. Verify artifact quality
4. Identify pain points
5. Assess pricing willingness

---

## 📋 Test Checklist

### Phase 1: Initial Setup & Navigation (5 minutes)

**Objective:** Verify the app loads and UI is intuitive.

- [ ] **Load Application**
  - Open http://localhost:3000 in browser
  - Verify page loads without errors
  - Check console for JavaScript errors (F12 → Console tab)
  - **Expected:** Clean page load, no red errors

- [ ] **Inspect Landing Page**
  - Read headline: "Upload your audio. Get studio-ready stems + session files."
  - Verify file upload form is prominent
  - Check supported formats displayed (WAV, MP3, AIFF, FLAC)
  - **Expected:** Clear value proposition, file upload is primary CTA

- [ ] **Navigation Check**
  - Look for any navigation menu (top nav, sidebar, etc.)
  - Check if there are any hidden YouTube features
  - Verify no downloader/converter framing
  - **Expected:** File-upload-first interface, no YouTube visible

**Notes:** _Record any UX friction or confusion_

---

### Phase 2: File Upload Workflow (10 minutes)

**Objective:** Test file upload validation and job creation.

#### Test 2A: Valid File Upload (WAV)

- [ ] **Prepare Test File**
  - Use a short audio file (30 seconds - 2 minutes)
  - Format: WAV, MP3, AIFF, or FLAC
  - Size: Under 200MB (test with ~10-50MB)
  - **Tip:** If you don't have a file, create one:
    ```bash
    # Generate 30-second test audio (requires ffmpeg)
    ffmpeg -f lavfi -i sine=f=440:d=30 -q:a 9 -acodec libmp3lame test.mp3
    ```

- [ ] **Upload File**
  - Click "Choose File" button
  - Select test audio file
  - Verify filename appears in form
  - Click "Upload & Process" button
  - **Expected:** Button shows loading state (grayed out or spinner)

- [ ] **Verify Job Creation**
  - Page should redirect to job detail view
  - Job ID displayed (e.g., "Job: abc123def456")
  - Initial state should be "NEW" or "CLAIMED"
  - **Expected:** Job created successfully, no error messages

- [ ] **Check Job List**
  - Scroll down to "Jobs" section
  - Verify newly uploaded file appears in list
  - Check that filename is displayed (not YouTube URL)
  - **Expected:** Job shows in list with file metadata

**Notes:** _Record upload time, any validation errors_

#### Test 2B: File Size Validation

- [ ] **Test Large File (150MB)**
  - Create a 150MB test file
  - Attempt upload
  - **Expected:** Upload succeeds (under 200MB limit)

- [ ] **Test Oversized File (250MB)**
  - Create a 250MB test file
  - Attempt upload
  - **Expected:** Upload rejected with clear error message
  - **Error Message Should Say:** "File is too large. Maximum size is 200MB." (or similar)

- [ ] **Test Empty File**
  - Create empty file (0 bytes)
  - Attempt upload
  - **Expected:** Rejected with error message

**Notes:** _Record error message text exactly_

#### Test 2C: File Format Validation

- [ ] **Test Valid Formats**
  - Upload WAV file → **Expected:** Success
  - Upload MP3 file → **Expected:** Success
  - Upload AIFF file → **Expected:** Success
  - Upload FLAC file → **Expected:** Success

- [ ] **Test Invalid Format**
  - Try uploading a text file (.txt)
  - Try uploading an image (.jpg)
  - Try uploading a video (.mp4)
  - **Expected:** All rejected with clear error message
  - **Error Message Should Say:** "File format not supported. Please use WAV, MP3, AIFF, or FLAC." (or similar)

**Notes:** _Record which formats are accepted/rejected_

---

### Phase 3: Job Processing & State Transitions (15 minutes)

**Objective:** Monitor job through 4-stage pipeline and verify state machine.

#### Test 3A: Job Detail View

- [ ] **Open Job Detail**
  - Click on job in list or use job ID link
  - Verify job detail page loads
  - Check job ID, filename, upload time displayed
  - **Expected:** All metadata visible

- [ ] **Monitor Status Badge**
  - Check current state badge (color-coded)
  - Expected states in order: NEW → CLAIMED → RUNNING → DONE
  - **Color Coding:**
    - NEW = Blue
    - CLAIMED = Yellow
    - RUNNING = Purple
    - DONE = Green
    - FAILED = Red
  - **Expected:** Status updates as job progresses

#### Test 3B: Real-Time Log Monitoring

- [ ] **Check Job Logs**
  - Scroll to "Logs" section
  - Verify logs appear and update in real-time
  - Look for stage-specific messages:
    - "Stage 1: File ingestion" → filename, size
    - "Stage 2: Stem separation (Demucs)" → processing progress
    - "Stage 3: Lyrics extraction" → lyrics found/not found
    - "Stage 4: Artifact packaging" → ZIP creation
  - **Expected:** Logs show all 4 stages progressing

- [ ] **Monitor Processing Time**
  - Note start time (when job enters RUNNING)
  - Note end time (when job reaches DONE)
  - **Expected:** Total time 2-10 minutes depending on audio length and server load

#### Test 3C: State Transitions

- [ ] **NEW → CLAIMED**
  - Job should move from NEW to CLAIMED within seconds
  - **Expected:** Automatic transition

- [ ] **CLAIMED → RUNNING**
  - Job should move from CLAIMED to RUNNING within seconds
  - **Expected:** Automatic transition

- [ ] **RUNNING → DONE**
  - Job should complete all 4 stages
  - Final state should be DONE (green badge)
  - **Expected:** All stages complete successfully

**Notes:** _Record total processing time, any state stuck issues_

---

### Phase 4: Artifact Download & Verification (10 minutes)

**Objective:** Verify artifacts are generated correctly and downloadable.

#### Test 4A: Download Artifacts

- [ ] **Check Download Button**
  - Scroll to bottom of job detail
  - Verify "Download Artifacts" button appears (only if job is DONE)
  - Button should be enabled (not grayed out)
  - **Expected:** Download button visible and clickable

- [ ] **Download ZIP File**
  - Click "Download Artifacts"
  - Verify ZIP file downloads to Downloads folder
  - Check filename format (should include artist/track name)
  - **Expected:** ZIP downloads without errors

#### Test 4B: ZIP Structure Validation

- [ ] **Extract ZIP File**
  - Extract downloaded ZIP to a folder
  - List contents
  - **Expected Structure:**
    ```
    Artist - Track/
    ├── stems/
    │   ├── vocals.wav
    │   ├── drums.wav
    │   ├── bass.wav
    │   └── other.wav
    ├── lyrics.txt
    └── project.aup3
    ```

- [ ] **Verify Stems**
  - Check that 4 stem files exist (vocals, drums, bass, other)
  - All should be .wav format
  - File sizes should be reasonable (not 0 bytes)
  - **Expected:** All 4 stems present and valid

- [ ] **Verify Lyrics File**
  - Open lyrics.txt
  - Check if lyrics are present
  - If no lyrics found, should say "Lyrics not found for this track"
  - **Expected:** Either valid lyrics or clear "not found" message

- [ ] **Verify Audacity Project**
  - Check project.aup3 file exists
  - File size should be > 1KB (not empty)
  - **Expected:** Valid Audacity project file

**Notes:** _Record ZIP size, stem quality assessment (subjective), lyrics accuracy_

---

### Phase 5: Error Handling & Retry (10 minutes)

**Objective:** Test error scenarios and retry functionality.

#### Test 5A: Concurrency Limit

- [ ] **Upload Multiple Files Simultaneously**
  - Upload file #1
  - While #1 is processing, try uploading file #2
  - Try uploading file #3
  - **Expected Behavior:**
    - Files #1 and #2 should be accepted (1-2 concurrent jobs allowed)
    - File #3 should be rejected with error: "Too many concurrent jobs. Please wait."
    - Response code should be 429 (Too Many Requests)

- [ ] **Wait for Job to Complete**
  - Wait for job #1 to finish
  - Try uploading file #3 again
  - **Expected:** Now accepted (concurrency limit cleared)

**Notes:** _Record concurrency limit behavior_

#### Test 5B: Error Scenarios

- [ ] **Simulate Processing Failure (Optional)**
  - If possible, trigger a failure scenario (e.g., corrupt audio file)
  - **Expected:** Job transitions to FAILED state (red badge)
  - Error message should be user-friendly (no stack traces)
  - Example messages:
    - "Audio format not supported. Please use WAV, MP3, AIFF, or FLAC."
    - "Processing failed due to server capacity. Please try again later."
    - "Processing took too long. Please try a shorter audio file."

- [ ] **Test Retry Button**
  - If job is in FAILED state, look for "Retry" button
  - Click "Retry"
  - **Expected:** Job transitions back to NEW state
  - Job re-enters processing queue
  - Should process again without errors

**Notes:** _Record error messages, retry success_

---

### Phase 6: UI/UX Assessment (5 minutes)

**Objective:** Evaluate user experience and design quality.

#### Test 6A: Responsiveness

- [ ] **Desktop View (1920x1080)**
  - All elements visible and properly aligned
  - No horizontal scrolling
  - Buttons clickable and properly sized
  - **Expected:** Professional, clean layout

- [ ] **Mobile View (375x667)**
  - Resize browser to mobile size (or use DevTools)
  - File upload form still usable
  - Job list readable
  - Download button accessible
  - **Expected:** Responsive design, no broken layout

#### Test 6B: Visual Design

- [ ] **Color Scheme**
  - Dark theme consistent with E.G.O. aesthetic
  - Status badges clearly color-coded
  - Good contrast for readability
  - **Expected:** Professional, cohesive design

- [ ] **Typography & Spacing**
  - Text sizes readable
  - Proper spacing between elements
  - No cramped or cluttered layout
  - **Expected:** Clean, organized presentation

#### Test 6C: Error Messages

- [ ] **Clarity**
  - Error messages are user-friendly (no technical jargon)
  - No stack traces or error codes
  - Clear guidance on what went wrong
  - **Expected:** Non-technical users understand errors

- [ ] **Visibility**
  - Error messages are prominent
  - Not hidden or hard to find
  - **Expected:** Errors immediately visible

**Notes:** _Record UX friction points, design feedback_

---

### Phase 7: Producer Perspective Assessment (5 minutes)

**Objective:** Evaluate value proposition from producer's viewpoint.

- [ ] **Workflow Speed**
  - How fast is the entire process? (upload → download)
  - Is it faster than manual stem separation?
  - **Assessment:** Fast / Moderate / Slow

- [ ] **Stem Quality**
  - Are stems usable in a DAW (Ableton, FL Studio, etc.)?
  - Are stems clean (minimal bleeding between stems)?
  - Would you use these in a professional production?
  - **Assessment:** Professional / Acceptable / Poor

- [ ] **Session File Usefulness**
  - Is the Audacity project file useful?
  - Would you prefer a different format (Ableton, FL Studio)?
  - **Assessment:** Very useful / Somewhat useful / Not useful

- [ ] **Pricing Willingness**
  - Would you pay for this service?
  - What price would be fair? ($5/job, $10/job, $29/month, etc.)
  - What features would justify a higher price?
  - **Assessment:** Yes / Maybe / No

**Notes:** _Record producer feedback on value, pricing, feature requests_

---

## 📊 Test Results Template

Copy this template and fill out after testing:

```markdown
## LLM Test Run #1 Results

**Date:** [Date]
**Tester:** [LLM Model Name]
**Duration:** [Time spent]

### Upload Workflow
- File upload: ✅ PASS / ❌ FAIL
- File validation: ✅ PASS / ❌ FAIL
- Job creation: ✅ PASS / ❌ FAIL

### Job Processing
- State transitions: ✅ PASS / ❌ FAIL
- Processing time: [X minutes]
- All 4 stages completed: ✅ YES / ❌ NO

### Artifacts
- ZIP download: ✅ PASS / ❌ FAIL
- ZIP structure correct: ✅ YES / ❌ NO
- Stems present: ✅ YES / ❌ NO
- Lyrics present: ✅ YES / ❌ NO
- Audacity project: ✅ YES / ❌ NO

### Error Handling
- Concurrency limit: ✅ WORKS / ❌ BROKEN
- Error messages clear: ✅ YES / ❌ NO
- Retry functionality: ✅ WORKS / ❌ BROKEN

### UX Assessment
- Responsive design: ✅ YES / ❌ NO
- Visual design quality: ⭐ [1-5 stars]
- Error message clarity: ⭐ [1-5 stars]

### Producer Perspective
- Workflow speed: Fast / Moderate / Slow
- Stem quality: Professional / Acceptable / Poor
- Would pay: Yes / Maybe / No
- Fair price: $[X] per job or $[X] per month

### Issues Found
1. [Issue description]
2. [Issue description]

### Suggestions
1. [Feature request]
2. [UX improvement]

### Overall Assessment
[Summary of testing experience]
```

---

## 🚀 How to Use This Script

### For Human Testers
1. Follow each test phase in order
2. Check off completed tests
3. Record notes and observations
4. Fill out results template at end

### For LLM Testers
1. Read this entire script first
2. Follow each test phase systematically
3. For each test, describe what you see and verify against "Expected" outcome
4. Record exact error messages and behavior
5. Provide honest assessment of UX and producer value
6. Fill out results template with findings

### Running Multiple Test Rounds
- Run this script 3 times with different LLM models
- Compare results across runs
- Identify consistent issues vs. one-off problems
- Use findings to prioritize fixes

---

## 📝 Key Metrics to Track

| Metric | Target | Actual |
|--------|--------|--------|
| Upload success rate | 100% | ___ |
| Job completion rate | 95%+ | ___ |
| Processing time | <10 min | ___ |
| Artifact download success | 100% | ___ |
| ZIP structure correctness | 100% | ___ |
| Error message clarity | 5/5 stars | ___ |
| UI responsiveness | 5/5 stars | ___ |
| Producer willingness to pay | 1+ | ___ |

---

## 🐛 Issue Reporting

If you find bugs or issues:

1. **Describe the issue:** What happened vs. what should happen
2. **Reproduce steps:** Exact steps to reproduce
3. **Error message:** Copy exact error text (if any)
4. **Screenshot:** If possible, include screenshot
5. **Environment:** Browser, OS, file size/format

Report issues in: [PRODUCER_FEEDBACK.md](./PRODUCER_FEEDBACK.md)

---

## ✅ Test Completion Checklist

- [ ] All 7 phases completed
- [ ] Results template filled out
- [ ] Issues documented
- [ ] Feedback submitted
- [ ] Ready for next test round

**Estimated Time:** 30-45 minutes per test run

Good luck with testing! 🎵
