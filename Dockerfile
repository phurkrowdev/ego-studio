# Multi-stage Dockerfile for E.G.O. Studio Audio
# Optimized for production deployment with minimal image size

# Stage 1: Build dependencies and application
FROM node:22-alpine AS builder

# Install system dependencies for audio processing
RUN apk add --no-cache \
    python3 \
    py3-pip \
    gcc \
    g++ \
    make \
    ffmpeg \
    git

# Install Demucs for audio stem separation
RUN pip3 install --no-cache-dir demucs

# Install yt-dlp for YouTube downloads (optional, can be removed for file-upload-only)
RUN pip3 install --no-cache-dir yt-dlp

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install Node dependencies
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Build TypeScript and frontend
RUN pnpm run build

# Stage 2: Runtime image
FROM node:22-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl

# Install Demucs and yt-dlp in runtime image
RUN pip3 install --no-cache-dir demucs yt-dlp

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create storage directory for local uploads/artifacts
RUN mkdir -p /app/storage/uploads /app/storage/artifacts

# Set environment variables
ENV NODE_ENV=production
ENV STORAGE_ROOT=/app/storage
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Run application
CMD ["node", "dist/index.js"]
