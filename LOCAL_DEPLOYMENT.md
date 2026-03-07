# E.G.O. Studio Audio — Local Deployment Guide

This guide walks you through setting up E.G.O. Studio Audio on your local machine for producer testing.

## System Requirements

- **Node.js:** 18+ (LTS recommended)
- **npm/pnpm:** Latest version
- **Python:** 3.8+ (for Demucs audio separation)
- **ffmpeg:** For audio processing
- **Disk Space:** 10GB+ for audio files and stems
- **RAM:** 8GB+ (16GB recommended for Demucs)
- **GPU:** Optional but recommended (NVIDIA CUDA for faster stem separation)

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ego-studio-audio
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Install Python dependencies (for Demucs)
pip install torch torchaudio demucs
```

### 3. Set Up Environment Variables

Create a `.env.local` file in the project root:

```bash
# Database (local SQLite or MySQL)
DATABASE_URL="file:./dev.db"

# Storage (local filesystem)
STORAGE_ROOT="/tmp/ego-studio-jobs"

# OAuth (use test credentials if available)
VITE_APP_ID="<test-app-id>"
OAUTH_SERVER_URL="<test-oauth-url>"
JWT_SECRET="dev-secret-key-change-in-production"

# Optional: Genius API for lyrics
GENIUS_API_KEY="<your-genius-api-key>"
```

### 4. Initialize Database

```bash
pnpm db:push
```

### 5. Start the Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Testing Workflow

### Upload an Audio File

1. Navigate to the home page
2. Click "Choose File" and select a WAV, MP3, AIFF, or FLAC file (max 200MB)
3. Click "Upload & Process"
4. You'll be redirected to the job detail page

### Monitor Job Progress

The job will automatically transition through states:
- **NEW** → Created, waiting to be claimed
- **CLAIMED** → Worker picked up the job
- **RUNNING** → Processing (ingest → separate → lyrics → package)
- **DONE** → Complete, artifacts ready for download
- **FAILED** → Error occurred (see logs for details)

### Download Artifacts

When a job reaches **DONE** state:
1. Click "Download Artifacts" button
2. A ZIP file will be downloaded containing:
   - `stems/` — Separated audio tracks (drums, bass, vocals, etc.)
   - `lyrics.txt` — Extracted lyrics
   - `project.aup3` — Audacity project file with stems pre-loaded

### Troubleshooting

**Job stuck in CLAIMED state:**
- Check server logs: `tail -f .manus-logs/devserver.log`
- Verify Demucs is installed: `python -c "import demucs; print(demucs.__version__)"`

**Upload fails with "Unsupported file format":**
- Ensure file is WAV, MP3, AIFF, or FLAC
- Check file size (max 200MB)
- Try a different audio file

**Too many concurrent jobs error (429):**
- Wait 60 seconds before uploading another file
- Default limit is 2 concurrent jobs per user
- Check job list to see running jobs

**Demucs runs out of memory:**
- Reduce audio file size
- Use CPU mode instead of GPU (slower but uses less memory)
- Check available RAM: `free -h`

## Performance Tuning

### Enable GPU Acceleration (NVIDIA)

If you have an NVIDIA GPU:

```bash
# Install CUDA support
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Verify GPU is available
python -c "import torch; print(torch.cuda.is_available())"
```

### Adjust Demucs Model

In `server/lib/demucs-processor.ts`, change the model:

```typescript
// Faster but lower quality
const model = "htdemucs_ft";

// Slower but higher quality
const model = "htdemucs";
```

## Storage Management

### Local Storage Cleanup

Old artifacts (>14 days) are automatically deleted. To manually clean up:

```bash
rm -rf /tmp/ego-studio-jobs/artifacts/*
```

### Database Cleanup

To reset the database and start fresh:

```bash
rm dev.db
pnpm db:push
```

## Monitoring & Logs

### Server Logs

```bash
# Real-time logs
tail -f .manus-logs/devserver.log

# Job worker logs
grep "JobWorker" .manus-logs/devserver.log

# Upload endpoint logs
grep "Upload" .manus-logs/devserver.log
```

### Job Logs

Each job has its own log file:

```bash
cat /tmp/ego-studio-jobs/jobs/<STATE>/<JOB_ID>/logs.txt
```

## Feedback Collection

After testing, please document your experience in `PRODUCER_FEEDBACK.md`:

1. **Upload Experience:** Was the file upload process clear?
2. **Processing Time:** How long did stem separation take?
3. **Artifact Quality:** Were the stems usable in your DAW?
4. **Error Handling:** Were error messages clear and helpful?
5. **Willingness to Pay:** Would you pay for this service? If so, how much?

## Next Steps

- **Report Issues:** Create an issue in the GitHub repository
- **Suggest Features:** Document feature requests in feedback form
- **Share Results:** Send sample stems and project files for quality review

## Support

For questions or issues:
1. Check the logs (see Monitoring section)
2. Review the troubleshooting section above
3. Open an issue on GitHub with logs and reproduction steps

---

**Happy testing! 🎵**
