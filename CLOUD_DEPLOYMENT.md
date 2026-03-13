# Cloud Deployment Guide — E.G.O. Studio Audio

This guide covers deploying the Crimson MVP to cloud providers with S3-compatible storage backends.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [AWS ECS Deployment](#aws-ecs-deployment)
4. [DigitalOcean App Platform](#digitalocean-app-platform)
5. [Railway Deployment](#railway-deployment)
6. [Self-Hosted with Backblaze B2](#self-hosted-with-backblaze-b2)
7. [Environment Configuration](#environment-configuration)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## Architecture Overview

The Crimson MVP uses a **containerized, stateless architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                     Load Balancer                           │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    ┌───▼────┐              ┌────▼────┐
    │ App #1 │              │ App #2  │
    │ (Node) │              │ (Node)  │
    └───┬────┘              └────┬────┘
        │                        │
        └────────────┬───────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    ┌───▼────┐              ┌────▼────┐
    │ MySQL  │              │ Redis   │
    │ (DB)   │              │ (Queue) │
    └────────┘              └────┬────┘
                                 │
                        ┌────────┴────────┐
                        │                 │
                    ┌───▼────┐       ┌───▼────┐
                    │ S3/B2  │       │ Demucs │
                    │(Storage)       │ Worker │
                    └────────┘       └────────┘
```

**Key Components:**
- **App Servers**: Stateless Node.js instances (horizontally scalable)
- **Database**: MySQL for job metadata and user data
- **Queue**: Redis + Bull for async job processing
- **Storage**: S3-compatible (AWS S3, Backblaze B2, Minio)
- **Workers**: GPU-enabled instances for Demucs processing

---

## Prerequisites

### Hardware Requirements

- **Minimum**: 2 CPU cores, 4GB RAM, 20GB storage
- **Recommended**: 4 CPU cores, 8GB RAM, 50GB storage
- **GPU (optional)**: 4GB VRAM minimum for Demucs (NVIDIA recommended)

### Software Requirements

- Docker & Docker Compose
- Git
- AWS CLI (for AWS deployments)
- Backblaze CLI (for B2 deployments)

### Credentials Required

1. **Database**: MySQL connection string
2. **Redis**: Redis connection URL
3. **S3/B2**: Access keys and bucket name
4. **OAuth**: Manus OAuth credentials (VITE_APP_ID, OAUTH_SERVER_URL, etc.)

---

## AWS ECS Deployment

### Step 1: Create ECR Repository

```bash
# Create AWS ECR repository for Docker images
aws ecr create-repository \
  --repository-name ego-studio-audio \
  --region us-east-1

# Get ECR login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push Docker image
docker build -t ego-studio-audio:latest .
docker tag ego-studio-audio:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ego-studio-audio:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ego-studio-audio:latest
```

### Step 2: Create RDS MySQL Database

```bash
# Create RDS MySQL instance
aws rds create-db-instance \
  --db-instance-identifier ego-studio-audio-db \
  --db-instance-class db.t3.micro \
  --engine mysql \
  --engine-version 8.0 \
  --master-username admin \
  --master-user-password <STRONG_PASSWORD> \
  --allocated-storage 20 \
  --storage-type gp2 \
  --region us-east-1

# Get database endpoint
aws rds describe-db-instances \
  --db-instance-identifier ego-studio-audio-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --region us-east-1
```

### Step 3: Create ElastiCache Redis Cluster

```bash
# Create Redis cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id ego-studio-audio-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --region us-east-1

# Get Redis endpoint
aws elasticache describe-cache-clusters \
  --cache-cluster-id ego-studio-audio-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint' \
  --region us-east-1
```

### Step 4: Create S3 Bucket

```bash
# Create S3 bucket for uploads and artifacts
aws s3 mb s3://ego-studio-audio-prod --region us-east-1

# Enable versioning (optional)
aws s3api put-bucket-versioning \
  --bucket ego-studio-audio-prod \
  --versioning-configuration Status=Enabled

# Set lifecycle policy (auto-delete artifacts after 14 days)
cat > lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "Id": "DeleteOldArtifacts",
      "Status": "Enabled",
      "Prefix": "artifacts/",
      "Expiration": {
        "Days": 14
      }
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
  --bucket ego-studio-audio-prod \
  --lifecycle-configuration file://lifecycle.json
```

### Step 5: Create ECS Task Definition

Create `ecs-task-definition.json`:

```json
{
  "family": "ego-studio-audio",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "ego-studio-audio",
      "image": "<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ego-studio-audio:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "STORAGE_TYPE",
          "value": "s3"
        },
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        },
        {
          "name": "S3_BUCKET",
          "value": "ego-studio-audio-prod"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:ego-studio-audio/database-url"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:ego-studio-audio/redis-url"
        },
        {
          "name": "AWS_ACCESS_KEY_ID",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:ego-studio-audio/aws-access-key"
        },
        {
          "name": "AWS_SECRET_ACCESS_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:ego-studio-audio/aws-secret-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ego-studio-audio",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### Step 6: Create ECS Service

```bash
# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://ecs-task-definition.json \
  --region us-east-1

# Create ECS cluster
aws ecs create-cluster \
  --cluster-name ego-studio-audio \
  --region us-east-1

# Create ECS service
aws ecs create-service \
  --cluster ego-studio-audio \
  --service-name ego-studio-audio-service \
  --task-definition ego-studio-audio:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --region us-east-1
```

---

## DigitalOcean App Platform

### Step 1: Create App Spec

Create `app.yaml`:

```yaml
name: ego-studio-audio
services:
  - name: api
    github:
      repo: your-github-username/ego-studio-audio
      branch: main
    build_command: pnpm install && pnpm run build
    run_command: node dist/index.js
    http_port: 3000
    envs:
      - key: NODE_ENV
        value: production
      - key: STORAGE_TYPE
        value: s3
      - key: AWS_REGION
        value: nyc3
      - key: S3_BUCKET
        value: ego-studio-audio-prod
    env_slug: node-js
    instance_count: 2
    instance_size_slug: basic-s
    health_check:
      http_path: /health
    source_dir: /
    
databases:
  - name: mysql
    engine: MYSQL
    version: "8.0"
    production: true
    
  - name: redis
    engine: REDIS
    version: "7"
    production: true
```

### Step 2: Deploy

```bash
# Install doctl CLI
brew install doctl

# Authenticate
doctl auth init

# Create app from spec
doctl apps create --spec app.yaml
```

---

## Railway Deployment

### Step 1: Connect GitHub Repository

1. Visit [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub"
4. Connect your GitHub repository

### Step 2: Add Services

```bash
# Create railway.json
cat > railway.json << 'EOF'
{
  "build": {
    "builder": "dockerfile"
  },
  "deploy": {
    "startCommand": "node dist/index.js"
  }
}
EOF
```

### Step 3: Configure Environment Variables

In Railway dashboard:

```
NODE_ENV=production
STORAGE_TYPE=s3
AWS_REGION=us-east-1
S3_BUCKET=ego-studio-audio-prod
DATABASE_URL=mysql://...
REDIS_URL=redis://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Step 4: Add MySQL and Redis Plugins

1. Click "Add Plugin"
2. Select "MySQL" and "Redis"
3. Railway automatically injects connection strings

---

## Self-Hosted with Backblaze B2

Backblaze B2 is a cost-effective S3-compatible alternative (~$0.006/GB/month).

### Step 1: Create B2 Account

1. Visit [backblaze.com/b2](https://www.backblaze.com/b2)
2. Create account and bucket
3. Generate application key

### Step 2: Configure Environment

```bash
# .env.production
STORAGE_TYPE=s3
S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com
S3_FORCE_PATH_STYLE=true
S3_BUCKET=ego-studio-audio-prod
AWS_REGION=us-west-002
AWS_ACCESS_KEY_ID=<B2_APPLICATION_KEY_ID>
AWS_SECRET_ACCESS_KEY=<B2_APPLICATION_KEY>
```

### Step 3: Deploy with Docker Compose

```bash
# Create .env file with production values
cat > .env.production << 'EOF'
STORAGE_TYPE=s3
S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com
S3_FORCE_PATH_STYLE=true
S3_BUCKET=ego-studio-audio-prod
AWS_REGION=us-west-002
AWS_ACCESS_KEY_ID=<YOUR_B2_KEY_ID>
AWS_SECRET_ACCESS_KEY=<YOUR_B2_KEY>
DATABASE_URL=mysql://user:password@host:3306/ego_studio_audio
REDIS_URL=redis://host:6379
EOF

# Deploy
docker-compose -f docker-compose.yml up -d
```

---

## Environment Configuration

### Required Environment Variables

```bash
# Application
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=mysql://user:password@host:3306/ego_studio_audio

# Redis
REDIS_URL=redis://host:6379

# Storage
STORAGE_TYPE=s3                    # or 'local'
S3_BUCKET=ego-studio-audio-prod
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_ENDPOINT=                       # For S3-compatible (B2, Minio)
S3_FORCE_PATH_STYLE=false         # true for B2/Minio

# OAuth & API
JWT_SECRET=<strong-random-secret>
VITE_APP_ID=<manus-oauth-app-id>
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://oauth.manus.im
OWNER_OPEN_ID=<your-open-id>
OWNER_NAME=<your-name>
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=<forge-api-key>
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im
VITE_FRONTEND_FORGE_API_KEY=<frontend-forge-key>

# UI
VITE_APP_TITLE=E.G.O. Studio Audio
VITE_APP_LOGO=https://...
VITE_ANALYTICS_ENDPOINT=https://...
VITE_ANALYTICS_WEBSITE_ID=...
```

### Optional: GPU Worker Configuration

For dedicated Demucs processing:

```bash
# Worker instance environment
WORKER_MODE=true
WORKER_QUEUE=demucs_queue
CUDA_VISIBLE_DEVICES=0            # GPU device ID
DEMUCS_MODEL=htdemucs_6stems      # Model to use
```

---

## Monitoring & Troubleshooting

### Health Checks

```bash
# Check application health
curl https://your-app.com/health

# Check database
curl https://your-app.com/api/health/db

# Check Redis
curl https://your-app.com/api/health/redis

# Check S3
curl https://your-app.com/api/health/storage
```

### Logs

```bash
# AWS ECS
aws logs tail /ecs/ego-studio-audio --follow

# DigitalOcean
doctl apps logs <app-id> --follow

# Railway
railway logs

# Docker Compose
docker-compose logs -f app
```

### Common Issues

**Issue: Database connection timeout**
- Check security groups/firewall rules
- Verify DATABASE_URL format
- Test with `mysql -h host -u user -p`

**Issue: S3 authentication failed**
- Verify AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
- Check S3 bucket exists and is accessible
- For B2: Ensure S3_ENDPOINT and S3_FORCE_PATH_STYLE are correct

**Issue: Redis connection refused**
- Check REDIS_URL format
- Verify Redis is running and accessible
- Test with `redis-cli -u redis://host:6379`

**Issue: Demucs timeout**
- Increase container memory to 4GB+
- Use GPU instance for faster processing
- Check audio file size (>200MB may timeout)

### Performance Tuning

**Database Optimization:**
```sql
-- Add indexes for common queries
CREATE INDEX idx_jobs_user_state ON jobs(userId, state);
CREATE INDEX idx_jobs_created ON jobs(createdAt DESC);
```

**Redis Optimization:**
```bash
# Increase memory limit
redis-cli CONFIG SET maxmemory 2gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

**S3 Optimization:**
```bash
# Enable CloudFront CDN for artifact downloads
# Configure S3 bucket for static website hosting
# Use multipart upload for large files
```

---

## Scaling Strategy

### Horizontal Scaling

1. **App Servers**: Scale from 2 to N instances based on CPU/memory
2. **Database**: Use read replicas for scaling reads
3. **Redis**: Use Redis Cluster for horizontal scaling
4. **Workers**: Dedicated GPU instances for Demucs processing

### Vertical Scaling

1. **App**: Increase CPU/memory per instance
2. **Database**: Upgrade RDS instance class
3. **Redis**: Increase memory allocation
4. **Workers**: Use larger GPU instances (A100, H100)

### Cost Optimization

- **Spot Instances**: Use AWS Spot for non-critical workers (70% savings)
- **Reserved Instances**: For predictable baseline load
- **S3 Lifecycle**: Auto-delete artifacts after 14 days
- **Backblaze B2**: 10x cheaper than AWS S3 for storage

---

## Next Steps

1. Choose deployment platform (AWS, DigitalOcean, Railway, or self-hosted)
2. Set up infrastructure (database, Redis, S3)
3. Configure environment variables
4. Deploy Docker image
5. Run database migrations: `pnpm db:push`
6. Monitor health checks and logs
7. Set up auto-scaling policies
8. Configure monitoring and alerts

For questions or issues, refer to [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md) for local testing setup.
